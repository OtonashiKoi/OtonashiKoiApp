"use strict";
// Narrow, closed-event migration. Never run the full event-content upsert here.
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const config = require("../src/config");
const { RABBIT_BOSS_DIFFICULTY, RABBIT_BOSS_PHASES } = require("./lib/event-boss-content");
const BOSS_ID = "event-mantou-rabbit", BOSS_KEY = "mantou_rabbit";
const STATE_ID = "monsterState:event_boss_rabbit_preview";

function readBackup(directory, name) {
  const bytes = fs.readFileSync(path.join(directory, name + ".bson")), rows = [];
  for (let p = 0; p < bytes.length;) {
    const length = bytes.readInt32LE(p);
    assert.ok(length >= 5 && p + length <= bytes.length, "Invalid BSON: " + name);
    rows.push(BSON.deserialize(bytes.subarray(p, p + length))); p += length;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(directory, name + ".metadata.json")));
  assert.equal(rows.length, meta.count, "Backup count: " + name);
  assert.ok(Array.isArray(meta.indexes), "Index backup: " + name);
  return rows;
}

async function main() {
  const backup = process.argv.find(a => a.startsWith("--backup="))?.slice(9);
  assert.ok(backup, "A parse-verified external BSON backup is required");
  const root = path.resolve(__dirname, "..");
  assert.ok(!path.resolve(backup).startsWith(root + path.sep), "Backup must be outside repository");
  const beforeMonsters = readBackup(backup, "monsters");
  const beforeConfig = readBackup(backup, "worldBossConfig");
  const beforeLegacyStates = readBackup(backup, "monsterState");
  const beforeMaintenance = readBackup(backup, "maintenanceState");
  const original = beforeMonsters.find(m => m.id === BOSS_ID);
  assert.ok(original, "Rabbit missing from backup");
  const client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const db = client.db(config.storage.mongoDbName);
    const monster = await db.collection("monsters").findOne({ id: BOSS_ID });
    const bossConfig = await db.collection("worldBossConfig").findOne({ _id: BOSS_KEY });
    assert.deepEqual(monster, original, "Monster changed since backup; take a fresh backup");
    assert.deepEqual(bossConfig, beforeConfig.find(r => r._id === BOSS_KEY), "Config changed since backup");
    assert.equal(bossConfig.value.enabled, false, "Event must remain closed");
    assert.ok(require("../src/shared/worldBossAvailability").CLOSED_BOSS_KEYS.includes(BOSS_KEY));
    const maintenance = await db.collection("maintenanceState").find({}).toArray();
    assert.deepEqual(maintenance, beforeMaintenance, "Maintenance changed since backup");
    const states = [];
    for (const [collection, id, snapshot] of [
      ["monsters", STATE_ID, beforeMonsters],
      ["monsterState", "event_boss_rabbit_preview", beforeLegacyStates],
    ]) {
      const row = await db.collection(collection).findOne({ _id: id });
      if (!row) continue;
      assert.deepEqual(row, snapshot.find(r => r._id === id), "State changed since backup: " + collection);
      assert.equal((row.value?.participants || []).length, 0, "Cannot change an occupied encounter");
      assert.equal(Object.keys(row.value?.damageMap || {}).length, 0, "Cannot erase existing contribution");
      assert.ok(!row.value?.rabbit, "Cannot change an active rabbit mechanic");
      const value = structuredClone(row.value);
      // Use the state's own max so a fresh-backup resume after partial application
      // cannot multiply an already-updated HP pool a second time.
      const previousMax = value.coopMaxHp
        || Object.values(value.worldBossPartsMaxHp || {}).reduce((sum, hp) => sum + Number(hp || 0), 0)
        || monster.maxHp;
      const ratio = RABBIT_BOSS_DIFFICULTY.maxHp / previousMax;
      for (const key of ["currentHp", "coopMaxHp"]) {
        if (typeof value[key] === "number") value[key] = Math.round(value[key] * ratio);
      }
      for (const key of ["worldBossPartsHp", "worldBossPartsMaxHp"]) {
        if (value[key]) for (const part of Object.keys(value[key])) value[key][part] = Math.round(value[key][part] * ratio);
      }
      states.push({ collection, row, value });
    }
    console.log(JSON.stringify({ apply: process.argv.includes("--apply"), before: Object.fromEntries(Object.keys(RABBIT_BOSS_DIFFICULTY).map(k => [k, monster[k]])), after: RABBIT_BOSS_DIFFICULTY, phases: RABBIT_BOSS_PHASES, closed: true, stateRows: states.length }, null, 2));
    if (!process.argv.includes("--apply")) return;
    const updatedAt = new Date().toISOString();
    for (const state of states) {
      const result = await db.collection(state.collection).updateOne(
        { _id: state.row._id, value: state.row.value }, { $set: { value: state.value, updatedAt } },
      );
      assert.equal(result.matchedCount, 1, "State CAS failed: " + state.collection);
    }
    const result = await db.collection("monsters").updateOne(
      { id: BOSS_ID, updatedAt: monster.updatedAt }, { $set: { ...RABBIT_BOSS_DIFFICULTY, updatedAt } },
    );
    assert.equal(result.matchedCount, 1, "Monster CAS failed");
    const phaseResult = await db.collection("worldBossConfig").updateOne(
      { _id: BOSS_KEY, value: bossConfig.value }, { $set: { "value.phaseConfig": structuredClone(RABBIT_BOSS_PHASES), updatedAt } },
    );
    assert.equal(phaseResult.matchedCount, 1, "Config CAS failed");
    assert.deepEqual(await db.collection("monsters").findOne({ id: BOSS_ID }), { ...monster, ...RABBIT_BOSS_DIFFICULTY, updatedAt });
    assert.deepEqual(await db.collection("worldBossConfig").findOne({ _id: BOSS_KEY }), { ...bossConfig, value: { ...bossConfig.value, phaseConfig: structuredClone(RABBIT_BOSS_PHASES) }, updatedAt });
    for (const state of states) assert.deepEqual(await db.collection(state.collection).findOne({ _id: state.row._id }), { ...state.row, value: state.value, updatedAt });
    assert.deepEqual(await db.collection("maintenanceState").find({}).toArray(), beforeMaintenance);
    console.log("PASS: rabbit stats, phases and unoccupied HP read back; closure, drops, artwork and maintenance preserved");
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
