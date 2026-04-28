"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  
  const monsterStates = db.collection("monsterStates");
  
  // 查看所有文档
  const docs = await monsterStates.find({}).toArray();
  console.log(`找到 ${docs.length} 個狀態文檔\n`);
  
  for (const doc of docs) {
    console.log(`ID: ${doc._id}`);
    console.log(`Zone/Key: ${doc.zoneKey || doc.zone || "未知"}`);
    console.log(`Current HP: ${doc.currentHp}`);
    console.log(`---`);
  }
  
  await client.close();
}

main().catch(console.error);
