"use strict";
require("dotenv").config({ quiet: true });
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const { SET_DEFS } = require("../src/shared/equipmentSetBonuses");
const { buildItemEffectLines } = require("../src/shared/itemEffectLines");
const KEYS = ["might", "swift", "sage"];

function descriptionOf(item) {
  const def = SET_DEFS[item.setKey];
  const text = `${def.name}（D～A 同系列可混搭；達標效果累加）。`
    + def.tiers.map(t => `${t.count} 件：${t.desc}`).join("；")
    + "。同時計入所屬階級套裝。";
  const original = String(item.description || "");
  return original.includes(text) ? original : [original, text].filter(Boolean).join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = process.argv.find(a => a.startsWith("--backup-dir="))?.slice(13);
  if (apply) {
    assert.ok(backupDir && path.isAbsolute(backupDir), "Apply requires an absolute --backup-dir");
    const relative = path.relative(path.resolve(__dirname, ".."), backupDir);
    assert.ok(relative.startsWith(`..${path.sep}`), "Backups must be outside the repository");
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const items = client.db(process.env.MONGODB_DB_NAME || "equipment_game").collection("items");
    const rows = await items.find({ itemType: "equipment", tier: { $in: ["D", "C", "B", "A"] }, setKey: { $in: KEYS } }).toArray();
    for (const key of KEYS) assert.ok(rows.some(i => i.setKey === key), `Missing ${key} equipment`);
    const changes = rows.filter(i => descriptionOf(i) !== i.description);
    for (const item of changes) assert.equal(buildItemEffectLines(item).length, 0, `${item.name}: description fallback is hidden`);
    const summary = { apply, items: rows.length, changes: changes.length, bySet: Object.fromEntries(KEYS.map(k => [k, rows.filter(i => i.setKey === k).length])), sample: changes.slice(0, 2).map(i => ({ id: i.id, name: i.name, description: descriptionOf(i) })) };
    if (!apply || !changes.length) return console.log(JSON.stringify(summary, null, 2));

    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, "style-items.bson");
    const bytes = Buffer.concat(rows.map(i => BSON.serialize(i)));
    fs.writeFileSync(backupPath, bytes, { flag: "wx" });
    const read = fs.readFileSync(backupPath), restored = [];
    for (let offset = 0; offset < read.length;) {
      const size = read.readInt32LE(offset);
      assert.ok(size >= 5 && offset + size <= read.length, "Invalid BSON backup");
      restored.push(BSON.deserialize(read.subarray(offset, offset + size)));
      offset += size;
    }
    assert.deepEqual(restored, rows, "BSON backup readback mismatch");
    fs.writeFileSync(path.join(backupDir, "style-items.metadata.json"), JSON.stringify({ collection: "items", items: rows.length, at: new Date().toISOString(), sha256: require("node:crypto").createHash("sha256").update(read).digest("hex"), fieldsChanged: ["description"] }, null, 2), { flag: "wx" });

    for (const item of changes) {
      const filter = { _id: item._id, setKey: item.setKey, description: Object.hasOwn(item, "description") ? item.description : { $exists: false } };
      assert.equal((await items.updateOne(filter, { $set: { description: descriptionOf(item) } })).matchedCount, 1, `${item.name}: concurrent description edit`);
      assert.deepEqual(await items.findOne({ _id: item._id }), { ...item, description: descriptionOf(item) }, `${item.name}: unexpected field change`);
    }
    fs.writeFileSync(path.join(backupDir, "description-readback.json"), JSON.stringify({ ...summary, backupParsed: true, otherItemFieldsUnchanged: true, at: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ ...summary, backupParsed: true, otherItemFieldsUnchanged: true }, null, 2));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { descriptionOf };
