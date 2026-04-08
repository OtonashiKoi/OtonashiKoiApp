"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

(async () => {
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);

  const pid = "tester1";
  const prog = await db.collection("progress").findOne({ playerId: pid }) || { playerId: pid };
  prog.playerId = pid;
  prog.level = 10;
  prog.attributes = { str: 50, agi: 20, vit: 20, int: 5, dex: 10, luk: 5 };
  prog.equipment = prog.equipment || {};
  prog.equipment.weapon = { uuid: "w1", itemId: "test-sword", itemName: "測試劍", equipSlot: "weapon", weaponType: "sword_1h", isTwoHanded: false, equipStats: { str: 10 } };
  prog.updatedAt = new Date().toISOString();
  await db.collection("progress").updateOne({ playerId: pid }, { $set: prog }, { upsert: true });
  console.log("updated progress for", pid);
  await c.close();
})().catch((e)=>{console.error(e); process.exit(1);});
