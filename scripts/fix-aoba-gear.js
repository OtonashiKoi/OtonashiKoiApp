#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

async function main() {
  try {
    const db = await getMongoDb();
    const progressCollection = db.collection("progress");
    const itemCollection = db.collection("items");

    const progress = await progressCollection.findOne({ playerId: "159058930402721792" });
    if (!progress) {
      console.log("❌ 找不到玩家進度資料");
      process.exit(0);
    }

    console.log("分析玩家強化裝備...\n");

    // 檢查所有強化裝備
    const equipped = progress.equipment || {};
    let modified = false;

    for (const [slot, item] of Object.entries(equipped)) {
      if (!item?.enhanceLevel || item.enhanceLevel <= 0) continue;

      console.log(`[${slot}] ${item.itemName}`);
      console.log(`  enhanceLevel: ${item.enhanceLevel}`);
      console.log(`  current equipStats: ${JSON.stringify(item.equipStats)}`);

      // 取得原始物品定義
      const libItem = await itemCollection.findOne({ id: item.itemId });
      if (libItem) {
        console.log(`  original equipStats: ${JSON.stringify(libItem.equipStats)}`);

        // 計算預期的屬性值
        if (libItem.equipStats && typeof libItem.equipStats === 'object') {
          const expectedStats = { ...libItem.equipStats };
          // 找出主屬性（值最大的）
          const entries = Object.entries(expectedStats);
          if (entries.length > 0) {
            const mainStat = entries.sort((a, b) => b[1] - a[1])[0][0];
            expectedStats[mainStat] = (expectedStats[mainStat] || 0) + item.enhanceLevel;
            console.log(`  expected equipStats: ${JSON.stringify(expectedStats)}`);
            
            // 檢查是否不符
            const currentMain = item.equipStats?.[mainStat] || 0;
            if (currentMain !== expectedStats[mainStat]) {
              console.log(`  ⚠️ 不符！修正中...`);
              item.equipStats = expectedStats;
              modified = true;
            } else {
              console.log(`  ✅ 符合邏輯`);
            }
          }
        }
      }
      console.log();
    }

    if (modified) {
      await progressCollection.updateOne(
        { _id: progress._id },
        { $set: { equipment: progress.equipment, updatedAt: new Date().toISOString() } }
      );
      console.log("✅ 已修正！");
    } else {
      console.log("✅ 所有強化裝備都符合邏輯");
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ 修正失敗：", err);
    process.exit(1);
  }
}

main();
