#!/usr/bin/env node
"use strict";

/**
 * 遷移腳本：為所有玩家背包中的寶石進行堆疊合併
 * 用法: node scripts/migrate-gem-stacking.js
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

// 強化寶石 ID
const ENHANCE_GEM_IDS = {
  'D': '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  'C': '556db9e1-b084-4b22-bab5-a66c2b586184',
  'B': '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  'A': 'a6ae293d-52fc-4af5-8770-891ddf842e35'
};

const GEM_IDS = new Set(Object.values(ENHANCE_GEM_IDS));

async function main() {

  try {
    const db = await getMongoDb();
    const progressCollection = db.collection("progress");

    console.log("開始掃描玩家進度...");

    const cursor = progressCollection.find({
      "inventory": { $exists: true, $type: "array" }
    });

    let processedCount = 0;
    let modifiedCount = 0;
    let totalGemsStacked = 0;

    for await (const progress of cursor) {
      if (!Array.isArray(progress.inventory)) continue;

      const inventory = progress.inventory;
      let modified = false;

      // 按 itemId 分組寶石
      const gemsByItemId = {};
      const nonGemItems = [];

      // 第一遍：分離寶石和非寶石物品
      for (const item of inventory) {
        if (item?.itemId && GEM_IDS.has(item.itemId)) {
          if (!gemsByItemId[item.itemId]) {
            gemsByItemId[item.itemId] = { sample: item, count: 0 };
          }
          gemsByItemId[item.itemId].count += Math.max(1, item.stackCount || 1);
        } else {
          nonGemItems.push(item);
        }
      }

      // 第二遍：重建 inventory（先放非寶石，再放堆疊後的寶石）
      const hasMultipleGems = Object.values(gemsByItemId).some(g => g.count > 1);
      if (hasMultipleGems) {
        modified = true;

        const newInventory = [...nonGemItems];

        // 添加堆疊後的寶石
        for (const gemItemId in gemsByItemId) {
          const { sample, count } = gemsByItemId[gemItemId];
          const stackedGem = { ...sample, stackCount: count };
          newInventory.push(stackedGem);
          totalGemsStacked += count - 1; // 計算合併掉的寶石數量
        }

        progress.inventory = newInventory;
      }

      if (modified) {
        // 更新資料庫
        await progressCollection.updateOne(
          { _id: progress._id },
          { $set: { inventory, updatedAt: new Date().toISOString() } }
        );
        modifiedCount++;
      }

      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`已處理 ${processedCount} 名玩家...`);
      }
    }

    console.log(`\n✅ 遷移完成！`);
    console.log(`   掃描玩家數：${processedCount}`);
    console.log(`   修改玩家數：${modifiedCount}`);
    console.log(`   合併寶石數：${totalGemsStacked}`);

  } catch (err) {
    console.error("❌ 遷移失敗：", err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
