#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

async function main() {
  try {
    const db = await getMongoDb();
    const playerCollection = db.collection("players");
    const progressCollection = db.collection("progress");

    // 搜尋玩家名稱
    const searchName = "青葉ABC";
    const player = await playerCollection.findOne({
      displayName: { $regex: searchName, $options: 'i' }
    });

    if (!player) {
      console.log(`❌ 找不到玩家 "${searchName}"`);
      process.exit(0);
    }

    console.log(`✅ 找到玩家：${player.displayName} (ID: ${player.discordId})\n`);

    const progress = await progressCollection.findOne({ playerId: player.discordId });
    if (!progress || !Array.isArray(progress.inventory)) {
      console.log("❌ 玩家沒有進度資料");
      process.exit(0);
    }

    // 找出所有強化裝備
    const enhanced = progress.inventory.filter(item => item?.enhanceLevel && item.enhanceLevel > 0);
    
    if (enhanced.length === 0) {
      console.log("ℹ️ 玩家沒有強化裝備");
      process.exit(0);
    }

    console.log(`強化裝備 (${enhanced.length} 件):\n`);
    enhanced.forEach((item, i) => {
      console.log(`${i + 1}. ${item.itemName}`);
      console.log(`   enhanceLevel: ${item.enhanceLevel}`);
      console.log(`   tier: ${item.tier}`);
      console.log(`   equipStats: ${JSON.stringify(item.equipStats)}`);
      console.log(`   atkStat: ${item.atkStat}`);
      console.log(`   itemType: ${item.itemType}`);
      console.log();
    });

    process.exit(0);
  } catch (err) {
    console.error("❌ 查詢失敗：", err);
    process.exit(1);
  }
}

main();
