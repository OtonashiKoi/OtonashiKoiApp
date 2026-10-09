"use strict";
require("dotenv").config({ quiet: true });
const fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { MongoClient, BSON } = require("mongodb");
const rules = require("../src/shared/partyTowerRewardRules");
const { selectable } = require("../src/services/shop/weaponChoiceChest");
function readBson(file) {
  const data = fs.readFileSync(file), rows = [];
  for (let offset = 0; offset < data.length;) {
    const length = data.readInt32LE(offset);
    assert(length >= 5 && offset + length <= data.length);
    rows.push(BSON.deserialize(data.subarray(offset, offset + length))); offset += length;
  }
  return rows;
}
async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game"), apply = process.argv.includes("--apply");
    const backup = process.argv.find(a => a.startsWith("--backup="))?.slice(9);
    const image = await db.collection("items").findOne({ id: "chest-a-weapon-select" });
    assert(image, "existing box artwork required");
    for (const id of [require("../src/shared/enhanceConfig").ENHANCE_GEMS.A, "gem-s-tier"]) assert(await db.collection("items").findOne({ id, itemType: "consumable" }));
    const items = await db.collection("items").find({}).toArray();
    const counts = Object.fromEntries(["A", "S"].map(t => [t, items.filter(i => selectable(i, t)).length]));
    assert(counts.A && counts.S, "both selection pools must be nonempty");
    const definitions = { items: rules.boxes(image), weeklyQuests: rules.quests() };
    const preview = { apply, selectionCounts: counts, checkpoints: { normal: "A3-5 / 5 floors", challenge: "A4-6 + S1 / 5 floors" }, definitions };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return;
    assert(backup && fs.existsSync(backup), "parse-verified external backup required");
    const now = new Date().toISOString();
    for (const [name, defs] of Object.entries(definitions)) {
      const snapshot = readBson(path.join(backup, name + ".bson"));
      JSON.parse(fs.readFileSync(path.join(backup, name + ".metadata.json"), "utf8"));
      for (const def of defs) {
        const prior = snapshot.find(i => i.id === def.id), current = await db.collection(name).findOne({ id: def.id });
        if (current) for (const key of Object.keys(def)) assert.deepEqual(current[key], def[key], "existing definition differs; preserve it");
        else assert(!prior, "definition changed since backup");
      }
    }
    for (const [name, defs] of Object.entries(definitions)) for (const def of defs) {
      await db.collection(name).updateOne({ id: def.id }, { $setOnInsert: { ...def, createdAt: now, updatedAt: now } }, { upsert: true });
      const live = await db.collection(name).findOne({ id: def.id });
      for (const key of Object.keys(def)) assert.deepEqual(live[key], def[key]);
    }
    console.log("PASS 2 choice boxes and 2 seasonal first-clear quests inserted/read back; existing items, quests and player progress preserved");
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { readBson };
