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

  // 更新 mid state activeMonsterSeq 回 1（第一隻） — 優先從 monsters collection 讀取，並同時寫回 monsters + legacy
  const stateDocId = 'monsterState:mid';
  const monstersRow = await db.collection('monsters').findOne({ _id: stateDocId }).catch(() => null);
  const legacyRow = await db.collection('monsterState').findOne({ _id: 'mid' }).catch(() => null);
  const existing = monstersRow || legacyRow;
  const val = (existing && existing.value) ? { ...existing.value } : {};
  val.activeMonsterSeq = 1;
  try {
    await db.collection('monsters').updateOne({ _id: stateDocId }, { $set: { value: val, updatedAt: new Date().toISOString() } }, { upsert: true });
  } catch (e) { /* ignore */ }
  await db.collection('monsterState').updateOne(
    { _id: 'mid' },
    { $set: { value: val, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log('mid state activeMonsterSeq -> 1 (monsters + legacy)');

  await client.close();
  console.log("done");
})().catch(console.error);
