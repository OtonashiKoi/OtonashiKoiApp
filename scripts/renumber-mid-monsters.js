"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

(async () => {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  const col = db.collection("monsters");

  // mid 怪物按舊 seq 排序，重新 assign 1,2,3...
  const docs = await col.find({ zone: "mid" }).sort({ seq: 1 }).toArray();
  for (let i = 0; i < docs.length; i++) {
    const newSeq = i + 1;
    await col.updateOne({ id: docs[i].id }, { $set: { seq: newSeq } });
    console.log("renamed: " + docs[i].name + "  seq " + docs[i].seq + " -> " + newSeq);
  }

  // 更新 mid state activeMonsterSeq 回 1（第一隻）
  const stateCol = db.collection("monsterState");
  const existing = await stateCol.findOne({ _id: "mid" });
  const val = (existing && existing.value) ? { ...existing.value } : {};
  val.activeMonsterSeq = 1;
  await stateCol.updateOne(
    { _id: "mid" },
    { $set: { value: val, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log("mid state activeMonsterSeq -> 1");

  await client.close();
  console.log("done");
})().catch(console.error);
