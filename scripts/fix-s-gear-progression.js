"use strict";
require("dotenv").config();
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { MongoClient, BSON } = require("mongodb");
const { planContent } = require("./lib/complete-gear-drops");

async function main() {
  const apply = process.argv.includes("--apply");
  const backup = process.argv.find(x => x.startsWith("--backup-dir="))?.slice(13);
  if (apply) assert.ok(backup && path.isAbsolute(backup) && !path.resolve(backup).startsWith(path.resolve(__dirname, "..") + "/"), "external backup required");
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB_NAME);
    const items = await db.collection("items").find({}).toArray();
    const monsters = await db.collection("monsters").find({}).toArray();
    const desired = planContent(items, monsters).s;
    const changes = desired.map(next => ({ old: items.find(i => i.id === next.id), next }));
    assert.ok(changes.every(x => x.old && x.old.tier === "S"));
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", changes: changes.length }));
    if (!apply) return;
    fs.mkdirSync(backup, { recursive: true });
    for (const [name, rows] of [["items", items], ["monsters", monsters]]) {
      const file = path.join(backup, `${name}.bson`);
      fs.writeFileSync(file, Buffer.concat(rows.map(x => BSON.serialize(x))), { flag: "wx" });
      const bytes = fs.readFileSync(file); let pos = 0, count = 0;
      while (pos < bytes.length) { const len = bytes.readInt32LE(pos); assert.deepEqual(BSON.deserialize(bytes.subarray(pos, pos + len)), rows[count++]); pos += len; }
      assert.equal(count, rows.length);
      fs.writeFileSync(path.join(backup, `${name}.metadata.json`), JSON.stringify({ count, indexes: await db.collection(name).indexes() }));
    }
    for (const { old, next } of changes) {
      const r = await db.collection("items").updateOne({ _id: old._id, name: old.name, equipStats: old.equipStats }, { $set: { name: next.name, itemName: next.name, equipStats: next.equipStats } });
      assert.equal(r.matchedCount, 1, `Concurrent item change: ${old.id}`);
    }
    const names = new Map(changes.map(({ next }) => [next.id, next.name]));
    for (const old of monsters) {
      if (!(old.drops || []).some(d => names.has(d.itemId))) continue;
      const drops = old.drops.map(d => names.has(d.itemId) ? { ...d, itemName: names.get(d.itemId) } : d);
      const r = await db.collection("monsters").updateOne({ _id: old._id, drops: old.drops }, { $set: { drops } });
      assert.equal(r.matchedCount, 1, `Concurrent monster change: ${old.id}`);
    }
    for (const { next } of changes) {
      const actual = await db.collection("items").findOne({ id: next.id });
      assert.equal(actual.name, next.name); assert.deepEqual(actual.equipStats, next.equipStats);
    }
    console.log("Verified 34 S gear names and stats");
  } finally { await client.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
