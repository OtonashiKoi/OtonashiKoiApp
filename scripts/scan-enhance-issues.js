#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

async function main() {
  try {
    const db = await getMongoDb();
    const progressCollection = db.collection("progress");

    console.log("掃描有強化等級但屬性異常的裝備...\n");

    const cursor = progressCollection.find({
      "inventory": { $exists: true, $type: "array" }
    });

    let issueCount = 0;
    const issues = [];

    for await (const progress of cursor) {
      if (!Array.isArray(progress.inventory)) continue;

      for (const item of progress.inventory) {
        // 尋找有強化等級的裝備
        if (item?.enhanceLevel && item.enhanceLevel > 0) {
          // 檢查是否有 equipStats
          if (!item.equipStats || typeof item.equipStats !== 'object' || Object.keys(item.equipStats).length === 0) {
            issues.push({
              playerId: progress.playerId,
              itemName: item.itemName,
              enhanceLevel: item.enhanceLevel,
              equipStats: item.equipStats,
              uuid: item.uuid
            });
            issueCount++;
          }
        }
      }
    }

    if (issueCount === 0) {
      console.log("✅ 沒有發現異常的強化裝備。");
    } else {
      console.log(`⚠️ 找到 ${issueCount} 件異常強化裝備：\n`);
      issues.slice(0, 20).forEach((issue, i) => {
        console.log(`${i + 1}. 玩家 ${issue.playerId}`);
        console.log(`   裝備：${issue.itemName} +${issue.enhanceLevel}`);
        console.log(`   屬性：${JSON.stringify(issue.equipStats)}`);
        console.log();
      });
      if (issueCount > 20) {
        console.log(`... 及其他 ${issueCount - 20} 件\n`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ 掃描失敗：", err);
    process.exit(1);
  }
}

main();
