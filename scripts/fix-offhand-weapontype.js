"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

(async () => {
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);
  const col = db.collection("items");

  // 副手劍：改 weaponType 為 offhand_sword
  const offhandSwords = ["精鐵短劍(副手)", "短劍(副手)"];
  for (const name of offhandSwords) {
    const r = await col.updateOne(
      { name },
      { $set: { weaponType: "offhand_sword" } }
    );
    console.log(name + " → weaponType=offhand_sword, matched=" + r.matchedCount);
  }

  await c.close();
  console.log("done");
})().catch(console.error);
