"use strict";
// Preview by default. Only embedded inventory/receipt metadata is converted;
// progress identity, quantities, reward receipts and currencies are preserved.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient, BSON } = require("mongodb");
const config = require("../src/config");
const { normalizeInventoryMongoIds } = require("../src/shared/inventoryStorage");

function changedFields(doc) {
  const normalized = normalizeInventoryMongoIds(doc);
  const fields = {};
  for (const key of ["inventory", "normalLiveDropReceipts"]) {
    if (Array.isArray(doc[key]) && JSON.stringify(doc[key]) !== JSON.stringify(normalized[key])) {
      fields[key] = normalized[key];
    }
  }
  return fields;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = process.argv.find(arg => arg.startsWith("--backup-dir="))?.slice(13);
  const root = path.resolve(__dirname, "..");
  if (apply && (!backupDir || !path.isAbsolute(backupDir) || path.resolve(backupDir).startsWith(root + path.sep))) {
    throw new Error("Apply requires --backup-dir=/absolute/path/outside/repository");
  }
  if (apply) fs.mkdirSync(backupDir, { recursive: true });
  const client = await MongoClient.connect(config.storage.mongoUri);
  try {
    const col = client.db(config.storage.mongoDbName).collection("progress");
    let candidates = 0, repaired = 0, idCount = 0;
    for await (const original of col.find({ $or: [
      { "inventory._id": { $type: "object" } }, { "inventory._id": { $type: "objectId" } },
      { "normalLiveDropReceipts.entries._id": { $type: "object" } },
      { "normalLiveDropReceipts.entries._id": { $type: "objectId" } }
    ] })) {
      let doc = original;
      let fields = changedFields(doc);
      if (!Object.keys(fields).length) continue;
      candidates++;
      const entries = [...(doc.inventory || []), ...(doc.normalLiveDropReceipts || []).flatMap(r => r.entries || [])];
      idCount += entries.filter(e => e._id && typeof e._id === "object").length;
      if (!apply) continue;
      let done = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        fields = changedFields(doc);
        if (!Object.keys(fields).length) { done = true; break; }
        const backupPath = path.join(backupDir, `${String(doc.playerId).replace(/[^a-zA-Z0-9_-]/g, "_")}-${attempt}.bson`);
        const bytes = BSON.serialize(doc);
        fs.writeFileSync(backupPath, bytes, { flag: "wx", mode: 0o600 });
        assert.deepEqual(BSON.deserialize(fs.readFileSync(backupPath)), doc, "verified pre-write BSON backup");
        const updatedAt = new Date(Math.max(Date.now(), (Date.parse(doc.updatedAt) || 0) + 1)).toISOString();
        const result = await col.updateOne({ _id: doc._id,
          updatedAt: doc.updatedAt === undefined ? { $exists: false } : doc.updatedAt
        }, { $set: { ...fields, updatedAt } });
        if (result.matchedCount) {
          const actual = await col.findOne({ _id: doc._id });
          // A later game write may have appended loot; it must still be canonical.
          assert.equal(Object.keys(changedFields(actual)).length, 0, "durable IDs remain canonical");
          repaired++; done = true; break;
        }
        doc = await col.findOne({ _id: doc._id });
        if (!doc) throw new Error("Progress disappeared during repair");
      }
      if (!done) throw new Error("Concurrent progress writes prevented metadata repair");
    }
    console.log(JSON.stringify({ apply, candidates, repaired, idCount }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { changedFields };
