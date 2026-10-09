"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const { loadBson } = require("./verify-normal-progression");
const KEY = "castle_golem_petrify";
const PCTS = [25, 20, 15, 12.5, 10];
const DESCRIPTION = "血量低於30%時受到傷害降低50%，持續1回合；每場戰鬥第1～5次觸發分別恢復自身最大HP的25%、20%、15%、12.5%、10%，之後維持10%；冷卻5次自身出手，新戰鬥重置。";
function patch(collection, row) {
  assert.equal(row.monsterCardSkill?.key, KEY);
  const fields = { "monsterCardSkill.healingPctByTrigger": PCTS, "monsterCardSkill.description": DESCRIPTION };
  if (collection === "items") fields.description = DESCRIPTION;
  else {
    assert.equal(row.equipment?.special_1?.monsterCardSkill?.key, KEY);
    fields["equipment.special_1.monsterCardSkill.healingPctByTrigger"] = PCTS;
    fields["equipment.special_1.monsterCardSkill.description"] = DESCRIPTION;
    // Some embedded snapshots also include the item description.
    if (row.equipment.special_1.description != null) fields["equipment.special_1.description"] = DESCRIPTION;
  }
  return fields;
}
function applyFields(row, fields) {
  const next = structuredClone(row);
  for (const [key, value] of Object.entries(fields)) {
    const parts = key.split("."), last = parts.pop(); let target = next;
    for (const part of parts) target = target[part];
    target[last] = structuredClone(value);
  }
  return next;
}
async function main() {
  require("dotenv").config({ quiet: true });
  const args = process.argv.slice(2), value = name => args.find(a => a.startsWith(name + "="))?.slice(name.length + 1);
  const snapshot = value("--snapshot"), output = value("--output");
  if (!snapshot || !output) throw Error("--snapshot=VERIFIED_BACKUP --output=EXTERNAL_PATH required");
  const plans = ["items", "monsters"].map(collection => {
    const rows = loadBson(path.join(snapshot, collection + ".bson"));
    const targets = rows.filter(r => r.monsterCardSkill?.key === KEY); assert.equal(targets.length, 1);
    return { collection, rows, original: targets[0], fields: patch(collection, targets[0]) };
  });
  if (args.includes("--candidate")) {
    fs.mkdirSync(output, { recursive: false });
    for (const plan of plans) fs.writeFileSync(path.join(output, plan.collection + ".bson"),
      Buffer.concat(plan.rows.map(r => BSON.serialize(r.id === plan.original.id ? applyFields(r, plan.fields) : r))));
    fs.copyFileSync(path.join(snapshot, "maintenanceState.bson"), path.join(output, "maintenanceState.bson"));
    fs.writeFileSync(path.join(output, "candidate-plan.json"), JSON.stringify({ source: "snapshot+plan", snapshot, pcts: PCTS }, null, 2));
    console.log("Candidate snapshot written; live database unchanged"); return;
  }
  const receipt = { at: new Date().toISOString(), snapshot, applied: false, changes: plans.map(({collection,original,fields}) => ({collection,id:original.id,fields})) };
  if (args.includes("--apply")) {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    try {
      const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");
      // Preflight both records against the verified backup before changing either.
      for (const p of plans) {
        const live = await db.collection(p.collection).findOne({ id: p.original.id });
        assert.deepEqual(live.monsterCardSkill, p.original.monsterCardSkill);
        if (p.collection === "monsters") assert.deepEqual(live.equipment.special_1, p.original.equipment.special_1);
      }
      for (const p of plans) {
        const result = await db.collection(p.collection).updateOne({ id: p.original.id, monsterCardSkill: p.original.monsterCardSkill }, { $set: p.fields });
        assert.equal(result.matchedCount, 1);
        const live = await db.collection(p.collection).findOne({ id: p.original.id });
        for (const [key, expected] of Object.entries(p.fields)) assert.deepEqual(key.split(".").reduce((v,k) => v[k], live), expected);
      }
      receipt.applied = true;
    } finally { await client.close(); }
  }
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(receipt.applied ? "Two live definitions applied and read back" : "Preview saved; live database unchanged");
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { PCTS, DESCRIPTION, patch, applyFields };
