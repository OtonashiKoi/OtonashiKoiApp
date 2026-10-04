"use strict";

// Default is read-only. --apply requires an external --backup-dir=... .
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const { buildPlan, REVISION } = require("./lib/normal-progression-balance");

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = process.argv.find(a => a.startsWith("--backup-dir="))?.slice(13);
  if (apply && (!backupDir || !path.isAbsolute(backupDir) || path.resolve(backupDir).startsWith(path.resolve(__dirname, "..") + path.sep))) {
    throw new Error("--apply requires an absolute backup directory outside the repository");
  }
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) throw new Error("Explicit MongoDB URI and DB name required");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME);
    const collection = db.collection("monsters");
    const originals = await collection.find({}).toArray();
    const plan = buildPlan(originals);
    console.log(JSON.stringify({ revision: REVISION, mode: apply ? "apply" : "preview", count: plan.length, plan }, null, 2));
    if (!apply || !plan.length) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, "monsters.bson");
    fs.writeFileSync(file, Buffer.concat(originals.map(d => BSON.serialize(d))), { flag: "wx" });
    const bytes = fs.readFileSync(file);
    let offset = 0, count = 0;
    while (offset < bytes.length) {
      const len = bytes.readInt32LE(offset);
      const doc = BSON.deserialize(bytes.subarray(offset, offset + len));
      assert.deepEqual(doc, originals[count++]);
      offset += len;
    }
    assert.equal(count, originals.length);
    fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify({ count, indexes: await collection.indexes(), plan }, null, 2), { flag: "wx" });
    const snapshots = {};
    for (const name of ["channelLayout", "monsterState"]) {
      const docs = await db.collection(name).find({}).toArray();
      snapshots[name] = docs;
      const target = path.join(backupDir, `${name}.bson`);
      fs.writeFileSync(target, Buffer.concat(docs.map(d => BSON.serialize(d))), { flag: "wx" });
      const saved = fs.readFileSync(target);
      let at = 0, n = 0;
      while (at < saved.length) {
        const len = saved.readInt32LE(at);
        assert.deepEqual(BSON.deserialize(saved.subarray(at, at + len)), docs[n++]);
        at += len;
      }
      assert.equal(n, docs.length);
      fs.writeFileSync(path.join(backupDir, `${name}.metadata.json`), JSON.stringify({ count: n, indexes: await db.collection(name).indexes() }));
    }
    // Compare the full source before each mutation. A concurrent admin edit aborts.
    for (const row of plan) {
      const before = originals.find(m => m.id === row.id);
      assert.deepEqual(await collection.findOne({ _id: before._id }), before);
      const guard = { _id: before._id };
      for (const [key, value] of Object.entries(before)) if (key !== "_id") guard[key] = { $eq: value };
      const result = await collection.updateOne(guard, { $set: row.values });
      assert.equal(result.modifiedCount, 1, `Concurrent edit: ${row.name}`);
      assert.deepEqual(await collection.findOne({ _id: before._id }), { ...before, ...row.values });
    }
    // These repositories persist live state in `value`; top-level legacy copies
    // are not authoritative. Do not rewrite unrelated channels or encounters.
    const levels = { monster_zone: 1, monster_zone_mid: 10, monster_zone_ancient_city: 20,
      monster_zone_ancient_city_deep: 30, monster_zone_dragon_realm: 40, monster_zone_hellfire: 40 };
    for (const doc of snapshots.channelLayout) {
      const bindings = doc.value?.discord?.bindings;
      if (!Array.isArray(bindings)) throw new Error("Unexpected channelLayout storage shape");
      const updated = bindings.map(b => b.featureKey in levels ? { ...b, minLevel: levels[b.featureKey], maxLevel: null } : b);
      const result = await db.collection("channelLayout").updateOne({ _id: doc._id, value: { $eq: doc.value } }, { $set: { "value.discord.bindings": updated } });
      assert.equal(result.matchedCount, 1, "Concurrent channel layout edit");
      assert.deepEqual((await db.collection("channelLayout").findOne({ _id: doc._id })).value.discord.bindings, updated);
    }
    for (const doc of snapshots.monsterState) {
      const state = doc.value;
      if (!state || Object.keys(state.damageMap || {}).length) continue;
      const before = originals.find(m => m.zone === doc._id && m.seq === state.activeMonsterSeq);
      const change = before && plan.find(p => p.id === before.id);
      if (!change) continue;
      const currentHp = Math.round(Math.max(0, Math.min(1, Number(state.currentHp) / (state.coopMaxHp || before.maxHp))) * change.values.maxHp);
      if (!Number.isFinite(currentHp)) throw new Error(`Invalid encounter HP: ${doc._id}`);
      const patch = { "value.currentHp": currentHp, "value.coopMaxHp": change.values.maxHp, "value.coopHpMonsterSeq": before.seq };
      const result = await db.collection("monsterState").updateOne({ _id: doc._id, value: { $eq: state } }, { $set: patch });
      assert.equal(result.matchedCount, 1, "Concurrent battle state edit");
      const after = await db.collection("monsterState").findOne({ _id: doc._id });
      assert.equal(after.value.currentHp, currentHp);
      assert.equal(after.value.coopMaxHp, change.values.maxHp);
    }
    assert.equal(buildPlan(await collection.find({}).toArray()).length, 0);
    console.log(`VERIFIED ${plan.length} monsters; BSON backup ${file}`);
  } finally { await client.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
