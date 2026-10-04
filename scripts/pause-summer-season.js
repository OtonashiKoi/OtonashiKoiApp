"use strict";

// Reversible season closure: back up BSON/indexes, then change only enabled flags.
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const config = require("../src/config");

async function main() {
  const out = process.argv[2];
  if (!out || !path.isAbsolute(out)) throw new Error("Provide an absolute external backup directory");
  const root = path.resolve(__dirname, "..");
  if (path.resolve(out).startsWith(root + path.sep)) throw new Error("Backup must be outside repository");
  fs.mkdirSync(out, { recursive: true });
  const selections = [
    ["monsters", { zone: { $in: ["event_1", "event_boss"] } }, "enabled"],
    ["worldBossConfig", { _id: "island_turtle" }, "value.enabled"],
    ["weeklyQuests", { $or: [{ id: "season-summer-four-kings" }, { type: "kill_island_turtle" }, { "subMetrics.type": "kill_island_turtle" }] }, "enabled"],
    ["shopItems", { name: /夏日時光/ }, "enabled"],
  ];
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  try {
    const db = client.db(config.storage.mongoDbName), snapshots = [];
    for (const [name, filter, field] of selections) {
      const documents = await db.collection(name).find(filter).toArray();
      if (!documents.length) throw new Error(`No records matched ${name}`);
      const bsonFile = path.join(out, `${name}.bson`), metadataFile = path.join(out, `${name}.metadata.json`);
      if (fs.existsSync(bsonFile)) throw new Error(`Backup already exists: ${bsonFile}`);
      fs.writeFileSync(bsonFile, Buffer.concat(documents.map(doc => BSON.serialize(doc))));
      const indexes = await db.collection(name).indexes();
      fs.writeFileSync(metadataFile, JSON.stringify(indexes, null, 2));
      assert.deepEqual(JSON.parse(fs.readFileSync(metadataFile)), JSON.parse(JSON.stringify(indexes)));
      const raw = fs.readFileSync(bsonFile), parsed = [];
      for (let at = 0; at < raw.length;) {
        const size = raw.readInt32LE(at);
        if (size < 5 || at + size > raw.length) throw new Error("Invalid BSON backup");
        parsed.push(BSON.deserialize(raw.subarray(at, at + size))); at += size;
      }
      assert.equal(BSON.EJSON.stringify(parsed), BSON.EJSON.stringify(documents));
      snapshots.push({ name, field, documents });
    }
    // All backups are verified before the first write. CAS leaves concurrent changes untouched.
    const changes = [];
    for (const { name, field, documents } of snapshots) {
      for (const doc of documents) {
        const oldValue = field === "value.enabled" ? doc.value?.enabled : doc.enabled;
        const expected = oldValue === undefined ? { $exists: false } : oldValue;
        const result = await db.collection(name).updateOne({ _id: doc._id, [field]: expected }, { $set: { [field]: false } });
        if (result.matchedCount !== 1) throw new Error(`Concurrent ${name} change; stop and review backup`);
        const after = await db.collection(name).findOne({ _id: doc._id });
        const expectedDoc = BSON.deserialize(BSON.serialize(doc));
        if (field === "value.enabled") expectedDoc.value.enabled = false;
        else expectedDoc.enabled = false;
        assert.equal(BSON.EJSON.stringify(after), BSON.EJSON.stringify(expectedDoc));
        changes.push({ collection: name, id: doc.id || doc._id, field, before: oldValue, after: false });
      }
    }
    const report = { verifiedAt: new Date().toISOString(), backupParsed: true, indexesVerified: true, changes };
    fs.writeFileSync(path.join(out, "changes.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await client.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
