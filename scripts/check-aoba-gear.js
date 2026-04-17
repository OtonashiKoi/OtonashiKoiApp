#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

async function main() {
  try {
    const db = await getMongoDb();
    const progressCollection = db.collection("progress");

    const progress = await progressCollection.findOne({ playerId: "159058930402721792" });
    if (!progress) {
      console.log("❌ 找不到玩家進度資料");
      process.exit(0);
    }

    console.log(`玩家：青葉ＡＢＣ\n`);
    console.log(`=== 背包中的強化裝備 ===\n`);

    const enhanced = progress.inventory.filter(item => item?.enhanceLevel && item.enhanceLevel > 0);
    
    if (enhanced.length === 0) {
      console.log("ℹ️ 沒有強化裝備");
    } else {
      enhanced.forEach((item, i) => {
        console.log(`${i + 1}. ${item.itemName}`);
        console.log(`   enhanceLevel: ${item.enhanceLevel}`);
        console.log(`   tier: ${item.tier}`);
        console.log(`   equipStats: ${JSON.stringify(item.equipStats)}`);
        console.log();
      });
    }

    console.log(`\n=== 身上裝備的強化裝備 ===\n`);

    const equipped = progress.equipment || {};
    const equippedEnhanced = Object.entries(equipped)
      .filter(([, item]) => item?.enhanceLevel && item.enhanceLevel > 0)
      .map(([slot, item]) => ({ slot, ...item }));

    if (equippedEnhanced.length === 0) {
      console.log("ℹ️ 沒有強化裝備");
    } else {
      equippedEnhanced.forEach((item, i) => {
        console.log(`${i + 1}. [${item.slot}] ${item.itemName}`);
        console.log(`   enhanceLevel: ${item.enhanceLevel}`);
        console.log(`   tier: ${item.tier}`);
        console.log(`   equipStats: ${JSON.stringify(item.equipStats)}`);
        console.log();
      });
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ 查詢失敗：", err);
    process.exit(1);
  }
}

main();
