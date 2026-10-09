"use strict";
// Preview first; scale once against an immutable, external BSON baseline.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const { NORMAL_ZONES, encounterCount } = require("../src/shared/encounterGroup");
const { MonsterService } = require("../src/services/monster/monsterService");
const REVISION = "map-lv40-hp2-atk1p5-20261008-v1";

function load(directory, name) {
  const bytes = fs.readFileSync(path.join(directory, name + ".bson")), rows = [];
  for (let p = 0; p < bytes.length;) {
    const n = bytes.readInt32LE(p);
    assert.ok(n >= 5 && p + n <= bytes.length, "Invalid BSON");
    rows.push(BSON.deserialize(bytes.subarray(p, p + n))); p += n;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(directory, name + ".metadata.json")));
  assert.equal(rows.length, meta.count); assert.ok(Array.isArray(meta.indexes));
  return rows;
}
function selected(m) {
  return Boolean(m.id && m.enabled && NORMAL_ZONES.has(m.zone) && m.level >= 40 && !m.allZones);
}
function buildPlan(baseline) {
  return baseline.filter(selected).map(m => {
    assert.ok(Number.isFinite(m.maxHp) && m.maxHp > 0 && Number.isFinite(m.str) && m.str > 0);
    assert.notEqual(m.mapLv40BuffRevision, REVISION, "Use the original baseline, not an already buffed snapshot");
    return { id: m.id, zone: m.zone, name: m.name, level: m.level,
      values: { maxHp: m.maxHp * 2, str: m.str * 1.5, mapLv40BuffRevision: REVISION } };
  });
}
function scaleState(value, monster, target) {
  const count = encounterCount(value, monster), max = target.maxHp * count;
  const previous = Number(value.coopMaxHp) > 0 ? value.coopMaxHp : monster.maxHp * count;
  const hp = value.currentHp == null ? max : Math.round(Math.max(0, Math.min(previous, Number(value.currentHp))) * max / previous);
  assert.ok(Number.isFinite(hp));
  return { ...value, currentHp: hp, coopMaxHp: max, coopHpMonsterSeq: monster.seq };
}
function guard(doc) {
  return Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, k === "_id" ? v : { $eq: v }]));
}
async function backup(db, directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ["monsters", "monsterState", "maintenanceState"]) {
    const rows = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(directory, name + ".bson"), Buffer.concat(rows.map(d => BSON.serialize(d))), { flag: "wx" });
    fs.writeFileSync(path.join(directory, name + ".metadata.json"), JSON.stringify({ count: rows.length, indexes: await db.collection(name).indexes() }, null, 2), { flag: "wx" });
    assert.deepEqual(load(directory, name), rows);
  }
}
async function main() {
  require("dotenv").config({ quiet: true });
  const arg = key => process.argv.find(a => a.startsWith(key + "="))?.slice(key.length + 1);
  const baselineDir = arg("--baseline"), backupDir = arg("--backup-dir"), apply = process.argv.includes("--apply");
  const root = path.resolve(__dirname, "..");
  for (const dir of [baselineDir, ...(apply ? [backupDir] : [])]) {
    assert.ok(dir && path.isAbsolute(dir) && !path.resolve(dir).startsWith(root + path.sep), "External absolute baseline/backup required");
  }
  const baseline = load(baselineDir, "monsters"), plan = buildPlan(baseline);
  assert.ok(plan.length, "No eligible monsters");
  if (arg("--output")) fs.writeFileSync(arg("--output"), JSON.stringify({ revision: REVISION, plan }, null, 2));
  assert.ok(process.env.MONGODB_URI && process.env.MONGODB_DB_NAME);
  if (apply) {
    const pm2 = JSON.parse(require("node:child_process").execFileSync("npx", ["pm2", "jlist"], { encoding: "utf8" }));
    assert.ok(pm2.some(p => p.name === "equipmentGAME" && p.pm2_env.status === "stopped"), "Stop the notified runtime before applying; keep gateway/tunnel running");
  }
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB_NAME), col = db.collection("monsters");
    const originals = await col.find({ id: { $exists: true } }).toArray(), changes = [];
    assert.deepEqual(originals.filter(selected).map(m => m.id).sort(), plan.map(m => m.id).sort(), "Eligibility changed");
    for (const row of plan) {
      const before = baseline.find(m => m.id === row.id), live = originals.find(m => m.id === row.id);
      const expected = { ...before, ...row.values };
      if (live.mapLv40BuffRevision === REVISION) assert.deepEqual(live, expected, "Buffed monster changed");
      else { assert.deepEqual(live, before, "Monster changed since baseline"); changes.push({ live, row, expected }); }
    }
    const states = [];
    for (const name of ["monsters", "monsterState"]) {
      for (const doc of await db.collection(name).find({ "value.activeMonsterSeq": { $exists: true } }).toArray()) {
        const zone = String(doc._id).replace(/^monsterState:/, "");
        const m = baseline.find(m => m.zone === zone && Number(m.seq) === Number(doc.value.activeMonsterSeq) && selected(m));
        if (!m) continue;
        const values = plan.find(p => p.id === m.id).values;
        const value = scaleState(doc.value, m, values);
        if (!require("node:util").isDeepStrictEqual(value, doc.value)) states.push({ name, doc, value });
      }
    }
    console.log(JSON.stringify({ revision: REVISION, apply, eligible: plan.length, pending: changes.length, stateRows: states.length }));
    if (!apply) return;
    await backup(db, backupDir);
    const maintenance = await db.collection("maintenanceState").find({}).toArray();
    for (const { live, row, expected } of changes) {
      const result = await col.updateOne(guard(live), { $set: row.values });
      assert.equal(result.modifiedCount, 1, "Monster CAS failed: " + row.name);
      assert.deepEqual(await col.findOne({ id: row.id }), expected);
    }
    for (const { name, doc, value } of states) {
      const result = await db.collection(name).updateOne(guard(doc), { $set: { value } });
      assert.equal(result.modifiedCount, 1, "State CAS failed: " + doc._id);
      assert.deepEqual(await db.collection(name).findOne({ _id: doc._id }), { ...doc, value });
    }
    const after = await col.find({ id: { $exists: true } }).toArray();
    for (const before of originals) {
      const row = plan.find(p => p.id === before.id);
      assert.deepEqual(after.find(m => m.id === before.id), row ? { ...baseline.find(m => m.id === row.id), ...row.values } : before);
    }
    const service = new MonsterService({ findAll: async () => after });
    const effective = await service.listMonsters();
    for (const row of plan) {
      const m = effective.find(m => m.id === row.id), old = baseline.find(m => m.id === row.id);
      assert.equal(m.calc.maxHp, old.maxHp * 2);
      assert.ok(Math.abs(m.calc.atk - old.str * 3 * 1.5) < 1e-8);
    }
    assert.deepEqual(await db.collection("maintenanceState").find({}).toArray(), maintenance);
    console.log(`PASS: ${plan.length} effective monsters, ${states.length} proportional state rows; other monster fields and maintenance preserved`);
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { REVISION, buildPlan, selected, scaleState };
