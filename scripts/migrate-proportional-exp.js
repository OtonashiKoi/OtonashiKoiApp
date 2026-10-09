"use strict";
require("dotenv").config({ quiet: true });
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { MongoClient, BSON } = require("mongodb");
const config = require("../src/config");
const { VERSION, OLD_CURVE, NEW_CURVE, planProgress } = require("./lib/proportional-exp-migration");
function backupCollection(out, name, rows, indexes) {
  const file = path.join(out, name + ".bson");
  fs.writeFileSync(file, Buffer.concat(rows.map(r => BSON.serialize(r))), { flag: "wx" });
  const bytes = fs.readFileSync(file), parsed = [];
  for (let i = 0; i < bytes.length;) {
    const n = bytes.readInt32LE(i);
    assert.ok(n >= 5 && i + n <= bytes.length, "invalid BSON length");
    parsed.push(BSON.deserialize(bytes.subarray(i, i + n))); i += n;
  }
  assert.deepEqual(parsed, rows, `${name} backup differs`);
  fs.writeFileSync(path.join(out, name + ".metadata.json"), JSON.stringify({ count: rows.length, indexes }, null, 2), { flag: "wx" });
}
async function main() {
  const apply = process.argv.includes("--apply");
  const outArg = process.argv.find(a => a.startsWith("--backup-dir="))?.slice(13);
  assert.ok(outArg && path.isAbsolute(outArg), "absolute external backup directory required");
  const out = path.resolve(outArg), root = path.resolve(__dirname, "..");
  assert.ok(out !== root && !out.startsWith(root + path.sep), "backup must be outside repository");
  fs.mkdirSync(out, { recursive: true });
  if (apply) {
    const list = JSON.parse(execFileSync(path.join(root, "node_modules/.bin/pm2"), ["jlist"], { encoding: "utf8" }));
    assert.equal(list.find(p => p.name === "equipmentGAME")?.pm2_env.status, "stopped", "stop runtime before applying");
  }
  const client = await MongoClient.connect(config.storage.mongoUri);
  try {
    const db = client.db(config.storage.mongoDbName);
    const source = {};
    for (const name of ["progress", "players", "wallets", "maintenanceState"]) source[name] = await db.collection(name).find({}).toArray();
    const at = new Date().toISOString();
    const plans = source.progress.map(doc => ({ doc, plan: planProgress(doc, at) })).filter(x => x.plan);
    const chars = plans.flatMap(x => x.plan.records);
    const summary = { version: VERSION, apply, accounts: source.progress.length, migratedAccounts: plans.length,
      characters: chars.length, leveledCharacters: chars.filter(r => r.gained > 0).length,
      grantedLevels: chars.reduce((s, r) => s + r.gained, 0),
      topUpCharacters: chars.filter(r => r.topUp > 0).length, topUpExp: chars.reduce((s, r) => s + r.topUp, 0),
      maxLevel: Math.max(...chars.map(r => r.newLevel), 1), totalRequirement: NEW_CURVE.reduce((s, v) => s + v, 0) };
    fs.writeFileSync(path.join(out, apply ? "apply-plan.json" : "preview.json"), JSON.stringify({ summary, oldCurve: OLD_CURVE, newCurve: NEW_CURVE, plans }, null, 2), { flag: "wx" });
    console.log(JSON.stringify(summary));
    if (!apply) return;
    for (const [name, rows] of Object.entries(source)) {
      backupCollection(out, name, rows, await db.collection(name).indexes());
      assert.deepEqual(await db.collection(name).find({}).toArray(), rows, `${name} changed during backup`);
    }
    // Full-document CAS guards every field. A failed/partial run can be retried;
    // the per-account marker prevents duplicate levels and attribute awards.
    for (const { doc, plan } of plans) {
      const r = await db.collection("progress").updateOne(
        { _id: doc._id, $expr: { $eq: ["$$ROOT", { $literal: doc }] } }, { $set: plan.set });
      assert.equal(r.matchedCount, 1, "concurrent progress edit; stop and inspect partial migration");
    }
    const readback = [];
    for (const { doc, plan } of plans) {
      const saved = await db.collection("progress").findOne({ _id: doc._id });
      assert.deepEqual(saved, { ...doc, ...plan.set }, "durable readback differs");
      assert.equal(planProgress(saved, at), null, "retry would duplicate migration");
      readback.push({ playerId: doc.playerId, characters: plan.records });
    }
    for (const name of ["players", "wallets", "maintenanceState"]) {
      assert.deepEqual(await db.collection(name).find({}).toArray(), source[name], `${name} must be unchanged`);
    }
    fs.writeFileSync(path.join(out, "readback.json"), JSON.stringify({ summary, verified: true, readback }, null, 2), { flag: "wx" });
    console.log("PASS: BSON/index backups parsed, full-document readback, retry guard, wallets and maintenance unchanged");
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
