"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

const UPDATES = [
  // Normal zone
  { name: "小史(小)", zone: "normal", entryFee: 20 },
  { name: "哥布",     zone: "normal", entryFee: 35 },
  { name: "石頭",     zone: "normal", entryFee: 50 },
  { name: "小狼",     zone: "normal", entryFee: 30 },
  { name: "大史(B)",  zone: "normal", entryFee: 200 },
  { name: "小金(稀)", zone: "normal", entryFee: 50 },
  // Mid zone
  { name: "甲蟹",     zone: "mid", entryFee: 400 },
  { name: "牙牙狼",   zone: "mid", entryFee: 350 },
  { name: "巨巨",     zone: "mid", entryFee: 600 },
  { name: "黑暗弓手", zone: "mid", entryFee: 450 },
  { name: "米拉桑(B)",zone: "mid", entryFee: 1200 },
];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");

  for (const u of UPDATES) {
    const result = await db.collection("monsters").updateOne(
      { name: u.name, zone: u.zone },
      { $set: { entryFee: u.entryFee } }
    );
    console.log(`${u.name} (${u.zone}): entryFee=${u.entryFee} matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }

  await client.close();
  console.log("Done.");
})();
