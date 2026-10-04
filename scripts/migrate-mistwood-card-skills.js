"use strict";
require("dotenv").config();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient, BSON } = require("mongodb");
const { skillForMistwoodMonster } = require("./lib/mistwood-card-skills");

async function main() {
  const apply = process.argv.includes("--apply");
  const backupDir = process.argv.find(x => x.startsWith("--backup-dir="))?.slice(13);
  if (apply) assert.ok(backupDir && path.isAbsolute(backupDir) && !path.resolve(backupDir).startsWith(path.resolve(__dirname, "..") + "/"), "external backup required");
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DB_NAME);
    const cards = await db.collection("items").find({ monsterCardOf: /^mistwood-monster-/ }).sort({ monsterCardOf: 1 }).toArray();
    assert.equal(cards.length, 7);
    const references = [];
    for (const collection of ["progress", "auctions"]) {
      const docs = await db.collection(collection).find({}).toArray();
      const found = docs.filter(x => JSON.stringify(x).includes("monster-card-mistwood-monster-"));
      if (found.length) references.push(`${collection}:${found.length}`);
    }
    assert.equal(references.length, 0, `Stored card copies require migration: ${references.join(", ")}`);
    for (const [index, card] of cards.entries()) {
      assert.equal(card.monsterCardOf, `mistwood-monster-${index + 1}`);
      assert.ok(card.monsterCardSkill?.key);
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", cards: cards.length, storedCopies: references.length }));
    if (!apply) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, "items.bson");
    fs.writeFileSync(backupFile, Buffer.concat(cards.map(x => BSON.serialize(x))), { flag: "wx" });
    const bytes = fs.readFileSync(backupFile); let offset = 0, count = 0;
    while (offset < bytes.length) {
      const size = bytes.readInt32LE(offset);
      assert.deepEqual(BSON.deserialize(bytes.subarray(offset, offset + size)), cards[count++]);
      offset += size;
    }
    assert.equal(count, cards.length);
    fs.writeFileSync(path.join(backupDir, "items.metadata.json"), JSON.stringify({ count, indexes: await db.collection("items").indexes() }));
    const updatedAt = new Date().toISOString();
    for (let index = 0; index < cards.length; index++) {
      const old = cards[index], skill = skillForMistwoodMonster(index + 1);
      const patch = { monsterCardSkill: skill, procEffects: structuredClone(skill.procEffects), description: skill.description, updatedAt };
      const result = await db.collection("items").updateOne({ _id: old._id, monsterCardSkill: old.monsterCardSkill, description: old.description }, { $set: patch });
      assert.equal(result.matchedCount, 1, `Concurrent card change: ${old.id}`);
    }
    for (let index = 0; index < cards.length; index++) {
      const actual = await db.collection("items").findOne({ id: cards[index].id });
      const skill = skillForMistwoodMonster(index + 1);
      assert.deepEqual(actual.monsterCardSkill, skill);
      assert.deepEqual(actual.procEffects, skill.procEffects);
      assert.equal(actual.description, skill.description);
      assert.equal(actual.imageUrl, cards[index].imageUrl);
    }
    console.log("Verified seven distinct live card skills");
  } finally { await client.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
