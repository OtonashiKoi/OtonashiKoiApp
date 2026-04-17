#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

async function main() {
  try {
    const db = await getMongoDb();
    const playerCollection = db.collection("players");

    // 搜尋含有「青葉」的玩家
    const players = await playerCollection.find({
      displayName: { $regex: "青葉", $options: 'i' }
    }).toArray();

    if (players.length === 0) {
      console.log("❌ 找不到含有「青葉」的玩家");
      process.exit(0);
    }

    console.log(`✅ 找到 ${players.length} 位玩家：\n`);
    players.forEach((p, i) => {
      console.log(`${i + 1}. ${p.displayName} (ID: ${p.discordId})`);
    });

    process.exit(0);
  } catch (err) {
    console.error("❌ 查詢失敗：", err);
    process.exit(1);
  }
}

main();
