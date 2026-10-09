"use strict";
require("dotenv").config({ quiet: true });
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const { GEAR_SLOTS, restoreEquipmentForLevel } = require("../src/shared/equipmentLevel");

function restoreUnderLevelEquipment(progress, libraryById) {
  const next = BSON.deserialize(BSON.serialize(progress)), moved = [];
  next.inventory = next.inventory || [];
  const activeSlot = [1, 2, 3].includes(Number(next.activeCharacterSlot)) ? String(next.activeCharacterSlot) : "1";
  const rootMoved = restoreEquipmentForLevel(next, next.inventory, libraryById);
  moved.push(...rootMoved.map(i => ({ ...i, characterSlot: activeSlot })));
  for (const [characterSlot, snapshot] of Object.entries(next.characterSlots || {})) {
    if (characterSlot === activeSlot) {
      if (rootMoved.length) snapshot.equipment = BSON.deserialize(BSON.serialize(next.equipment));
      continue;
    }
    moved.push(...restoreEquipmentForLevel(snapshot, next.inventory, libraryById).map(i => ({ ...i, characterSlot })));
  }
  return { next, moved };
}
function backupBson(dir, name, rows, indexes) {
  const file = path.join(dir, `${name}.bson`), bytes = Buffer.concat(rows.map(i => BSON.serialize(i)));
  fs.writeFileSync(file, bytes, { flag: "wx" });
  const read = fs.readFileSync(file), decoded = [];
  for (let pos = 0; pos < read.length;) {
    const size = read.readInt32LE(pos);
    assert.ok(size >= 5 && pos + size <= read.length);
    decoded.push(BSON.deserialize(read.subarray(pos, pos + size))); pos += size;
  }
  assert.deepEqual(decoded, rows, "BSON backup must match the actual snapshot");
  fs.writeFileSync(path.join(dir, `${name}.metadata.json`), JSON.stringify({ collection: name, count: rows.length, indexes, at: new Date().toISOString() }, null, 2), { flag: "wx" });
}
async function main() {
  const apply = process.argv.includes("--apply"), dir = process.argv.find(a => a.startsWith("--backup-dir="))?.slice(13);
  if (apply) {
    assert.ok(dir && path.isAbsolute(dir), "Use an absolute backup directory");
    assert.ok(path.relative(path.resolve(__dirname, ".."), dir).startsWith(`..${path.sep}`), "Backup must be outside the repository");
  }
  const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game"), collection = db.collection("progress");
    const items = await db.collection("items").find({ equipSlot: { $in: [...GEAR_SLOTS] } }).toArray();
    const libraryById = new Map(items.map(i => [i.id, i]));
    const rows = await collection.find({ $or: [{ level: { $lt: 30 } }, { characterSlots: { $exists: true } }] }).toArray();
    const updates = rows.map(before => ({ before, ...restoreUnderLevelEquipment(before, libraryById) })).filter(u => u.moved.length);
    const summary = { apply, players: updates.length, pieces: updates.reduce((n, u) => n + u.moved.length, 0) };
    if (!apply || !updates.length) return console.log(JSON.stringify(summary));
    fs.mkdirSync(dir, { recursive: true });
    const affectedItems = new Set(updates.flatMap(u => u.moved.map(i => i.itemId)));
    backupBson(dir, "progress", updates.map(u => u.before), await collection.indexes());
    backupBson(dir, "items", items.filter(i => affectedItems.has(i.id)), await db.collection("items").indexes());
    const maintenance = await db.collection("maintenanceState").find({}).toArray();
    backupBson(dir, "maintenanceState", maintenance, await db.collection("maintenanceState").indexes());
    const evidence = [];
    for (const { before, next, moved } of updates) {
      const change = { equipment: next.equipment, inventory: next.inventory, updatedAt: new Date().toISOString() };
      if (next.characterSlots) change.characterSlots = next.characterSlots;
      assert.equal((await collection.updateOne(before, { $set: change })).matchedCount, 1, "Concurrent progress change; rerun preview with a fresh backup directory");
      assert.deepEqual(await collection.findOne({ _id: before._id }), { ...before, ...change }, "Progress readback changed unrelated fields");
      for (const entry of moved) {
        const activeSlot = [1, 2, 3].includes(Number(before.activeCharacterSlot)) ? String(before.activeCharacterSlot) : "1";
        const original = entry.characterSlot === activeSlot ? before : before.characterSlots[entry.characterSlot];
        assert.deepEqual(next.inventory.find(i => i.uuid === entry.uuid), original.equipment[entry.slot]);
      }
      evidence.push({ playerId: before.playerId, level: before.level, moved });
    }
    assert.deepEqual(await db.collection("maintenanceState").find({}).toArray(), maintenance);
    fs.writeFileSync(path.join(dir, "restoration-readback.json"), JSON.stringify({ ...summary, backupParsed: true, instancesPreserved: true, unrelatedProgressFieldsUnchanged: true, evidence }, null, 2));
    console.log(JSON.stringify({ ...summary, backupParsed: true, instancesPreserved: true }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { restoreUnderLevelEquipment };
