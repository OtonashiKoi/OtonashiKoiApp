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

    console.log("掃描並修正所有玩家的強化裝備...\n");

    const cursor = progressCollection.find({});
    
    let processedCount = 0;
    let modifiedPlayers = 0;
    let fixedItems = 0;
    const details = [];

    for await (const progress of cursor) {
      let playerModified = false;

      // 掃描背包裝備
      if (Array.isArray(progress.inventory)) {
        for (const item of progress.inventory) {
          if (!item?.enhanceLevel || item.enhanceLevel <= 0) continue;
          
          const fixed = await checkAndFixItem(item, itemCollection);
          if (fixed) {
            playerModified = true;
            fixedItems++;
            details.push({
              playerId: progress.playerId,
              slot: 'inventory',
              itemName: item.itemName,
              enhanceLevel: item.enhanceLevel
            });
          }
        }
      }

      // 掃描身上裝備
      if (progress.equipment && typeof progress.equipment === 'object') {
        for (const [slot, item] of Object.entries(progress.equipment)) {
          if (!item?.enhanceLevel || item.enhanceLevel <= 0) continue;
          
          const fixed = await checkAndFixItem(item, itemCollection);
          if (fixed) {
            playerModified = true;
            fixedItems++;
            details.push({
              playerId: progress.playerId,
              slot: slot,
              itemName: item.itemName,
              enhanceLevel: item.enhanceLevel
            });
          }
        }
      }

      if (playerModified) {
        // 更新資料庫
        await progressCollection.updateOne(
          { _id: progress._id },
          { $set: { 
              inventory: progress.inventory,
              equipment: progress.equipment,
              updatedAt: new Date().toISOString() 
            } }
        );
        modifiedPlayers++;
      }

      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`已處理 ${processedCount} 名玩家...`);
      }
    }

    console.log(`\n✅ 修正完成！`);
    console.log(`   掃描玩家數：${processedCount}`);
    console.log(`   修改玩家數：${modifiedPlayers}`);
    console.log(`   修正裝備數：${fixedItems}`);

    if (details.length > 0) {
      console.log(`\n修正詳情 (前 20 件)：`);
      details.slice(0, 20).forEach((d, i) => {
        console.log(`${i + 1}. 玩家 ${d.playerId} - [${d.slot}] ${d.itemName} +${d.enhanceLevel}`);
      });
      if (details.length > 20) {
        console.log(`... 及其他 ${details.length - 20} 件`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ 修正失敗：", err);
    process.exit(1);
  }
}

async function checkAndFixItem(item, itemCollection) {
  if (!item?.itemId || !item?.enhanceLevel || item.enhanceLevel <= 0) return false;

  // 取得原始物品定義
  const libItem = await itemCollection.findOne({ id: item.itemId });
  if (!libItem || !libItem.equipStats || typeof libItem.equipStats !== 'object') return false;

  // 計算預期的屬性值
  const expectedStats = { ...libItem.equipStats };
  const entries = Object.entries(expectedStats);
  if (entries.length === 0) return false;

  // 找出主屬性（值最大的）
  const mainStat = entries.sort((a, b) => b[1] - a[1])[0][0];
  expectedStats[mainStat] = (expectedStats[mainStat] || 0) + item.enhanceLevel;

  // 檢查當前屬性是否符合預期
  const currentStats = item.equipStats || {};
  const originalStats = libItem.equipStats;

  // 不符合預期（太低）→ 修正
  // 也包含：enhanceLevel > 0 但 stats 跟道具庫原始值完全一樣 → 穿裝備 bug 覆蓋過的
  const isMismatch = Object.keys(expectedStats).some(key => {
    return (currentStats[key] || 0) !== expectedStats[key];
  });
  const isRevertedToOriginal = Object.keys(originalStats).every(key => {
    return (currentStats[key] || 0) === (originalStats[key] || 0);
  });

  if (isMismatch || isRevertedToOriginal) {
    item.equipStats = expectedStats;
    return true;
  }

  return false;
}

main();
