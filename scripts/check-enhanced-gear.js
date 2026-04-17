#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

async function main() {
  try {
    const db = await getMongoDb();
    const progressCollection = db.collection("progress");

    console.log("掃描所有強化的裝備...\n");

    const cursor = progressCollection.find({
      "inventory": { $exists: true, $type: "array" }
    });

    let count = 0;

    for await (const progress of cursor) {
      if (!Array.isArray(progress.inventory)) continue;

      const enhanced = progress.inventory.filter(item => item?.enhanceLevel && item.enhanceLevel > 0);
      
      if (enhanced.length > 0) {
        console.log(`玩家 ${progress.playerId}:`);
        enhanced.slice(0, 3).forEach(item => {
          console.log(`  ${item.itemName} +${item.enhanceLevel}`);
          console.log(`    equipStats: ${JSON.stringify(item.equipStats)}`);
          console.log(`    itemName with level: ${item.itemName.includes(' +') ? '有' : '無'}`);
        });
        console.log();
        
        count++;
        if (count >= 10) break;
      }
    }

    if (count === 0) {
      console.log("✅ 沒有找到任何強化的裝備。");
    } else {
      console.log(`已顯示前 ${count} 名玩家的強化裝備。`);
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ 掃描失敗：", err);
    process.exit(1);
  }
}

main();
