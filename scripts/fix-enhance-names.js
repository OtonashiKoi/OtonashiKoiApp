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

    console.log("掃描並修正強化裝備名稱...\n");

    const cursor = progressCollection.find({
      "inventory": { $exists: true, $type: "array" }
    });

    let processedCount = 0;
    let fixedCount = 0;
    let fixedItems = 0;

    for await (const progress of cursor) {
      if (!Array.isArray(progress.inventory)) continue;

      let modified = false;

      for (const item of progress.inventory) {
        if (item?.enhanceLevel && item.enhanceLevel > 0 && item.itemName) {
          // 檢查是否有重複的版本號（e.g., "+1 +1"）
          const regex = /\s\+(\d+)\s\+\d+$/;
          if (regex.test(item.itemName)) {
            // 修正：移除所有 " +數字"，然後只加一次正確的版本號
            const baseName = item.itemName.replace(/\s\+\d+/g, '');
            const correctName = `${baseName} +${item.enhanceLevel}`;
            item.itemName = correctName;
            modified = true;
            fixedItems++;
          }
        }
      }

      if (modified) {
        // 更新資料庫
        await progressCollection.updateOne(
          { _id: progress._id },
          { $set: { inventory: progress.inventory, updatedAt: new Date().toISOString() } }
        );
        fixedCount++;
      }

      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`已處理 ${processedCount} 名玩家...`);
      }
    }

    console.log(`\n✅ 修正完成！`);
    console.log(`   掃描玩家數：${processedCount}`);
    console.log(`   修改玩家數：${fixedCount}`);
    console.log(`   修正裝備數：${fixedItems}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ 修正失敗：", err);
    process.exit(1);
  }
}

main();
