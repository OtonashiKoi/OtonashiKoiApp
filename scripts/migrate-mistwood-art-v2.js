"use strict";
require("dotenv").config();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient, BSON } = require("mongodb");
const art = require("./lib/mistwood-art-v2.json");

async function backupRows(db, dir, name, rows) {
  const file = path.join(dir, `${name}.bson`);
  fs.writeFileSync(file, Buffer.concat(rows.map(row => BSON.serialize(row))), { flag: "wx" });
  const bytes = fs.readFileSync(file);
  let offset = 0, index = 0;
  while (offset < bytes.length) {
    const size = bytes.readInt32LE(offset);
    assert.deepEqual(BSON.deserialize(bytes.subarray(offset, offset + size)), rows[index++]);
    offset += size;
  }
  assert.equal(index, rows.length);
  fs.writeFileSync(path.join(dir, `${name}.metadata.json`), JSON.stringify({ count: index, indexes: await db.collection(name).indexes() }));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = process.argv.find(x => x.startsWith("--backup-dir="))?.slice(13);
  if (apply) assert.ok(backupDir && path.isAbsolute(backupDir) && !path.resolve(backupDir).startsWith(path.resolve(__dirname, "..") + "/"), "external backup required");
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB_NAME);
    const monsters = await db.collection("monsters").find({ zone: "mistwood" }).sort({ seq: 1 }).toArray();
    assert.equal(monsters.length, 7);
    const cards = await db.collection("items").find({ monsterCardOf: { $in: monsters.map(m => m.id) } }).toArray();
    assert.equal(cards.length, 7);
    for (const monster of monsters) {
      assert.ok(art[monster.id]?.imageUrl && art[monster.id]?.imageThumbnailUrl);
      assert.equal(cards.filter(card => card.monsterCardOf === monster.id).length, 1);
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", monsters: monsters.length, cards: cards.length }));
    if (!apply) return;
    fs.mkdirSync(backupDir, { recursive: true });
    await backupRows(db, backupDir, "monsters", monsters);
    await backupRows(db, backupDir, "items", cards);
    const updatedAt = new Date().toISOString();
    for (const monster of monsters) {
      const { imageUrl, imageThumbnailUrl } = art[monster.id];
      const patch = { imageUrl, imageThumbnailUrl, updatedAt };
      const result = await db.collection("monsters").updateOne({ _id: monster._id, imageUrl: monster.imageUrl, imageThumbnailUrl: monster.imageThumbnailUrl }, { $set: patch });
      assert.equal(result.matchedCount, 1, `Concurrent monster change: ${monster.id}`);
      const card = cards.find(x => x.monsterCardOf === monster.id);
      const cardResult = await db.collection("items").updateOne({ _id: card._id, imageUrl: card.imageUrl, imageThumbnailUrl: card.imageThumbnailUrl }, { $set: patch });
      assert.equal(cardResult.matchedCount, 1, `Concurrent card change: ${card.id}`);
    }
    for (const monster of monsters) {
      const actual = await db.collection("monsters").findOne({ id: monster.id });
      const card = await db.collection("items").findOne({ monsterCardOf: monster.id });
      assert.equal(actual.imageUrl, art[monster.id].imageUrl);
      assert.equal(actual.imageThumbnailUrl, art[monster.id].imageThumbnailUrl);
      assert.equal(card.imageUrl, actual.imageUrl);
      assert.equal(card.imageThumbnailUrl, actual.imageThumbnailUrl);
    }
    console.log("Verified all monster and linked card images");
  } finally { await client.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
