"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

(async () => {
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);

  const first = await db.collection("progress").findOne({});
  if (!first) { console.log("no data"); await c.close(); return; }
  console.log("progress keys:", Object.keys(first));
  if (first.equipment) console.log("equipment keys:", Object.keys(first.equipment));

  // 找有 shield 裝備的玩家
  const withShield = await db.collection("progress").findOne({ "equipment.shield": { $exists: true, $ne: null } });
  if (withShield) console.log("shield slot sample:", JSON.stringify(withShield.equipment.shield, null, 2));
  else console.log("no player with shield equipped");

  // 找背包有 shield slot 的
  const players = await db.collection("progress").find({}).toArray();
  for (const p of players) {
    const shieldInInv = (p.inventory || []).filter(i => i.equipSlot === "shield");
    if (shieldInInv.length > 0) {
      console.log("playerId:", p._id, "inv shield:", JSON.stringify(shieldInInv));
    }
  }

  await c.close();
})().catch(console.error);
