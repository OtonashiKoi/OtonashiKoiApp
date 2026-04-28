"use strict";

/**
 * 將 2 等以上、10 等以下玩家身上的職業徽章拆下來放回背包
 * 執行：node scripts/unequip-job-badges-level-2-10.js
 * 加 --dry-run 只列印不寫入
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const isDryRun = process.argv.includes("--dry-run");

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);

  const progresses = await db.collection("progress").find({ level: { $gte: 2, $lt: 10 } }).toArray();
  console.log(`找到 ${progresses.length} 位 2-9 等玩家`);

  let unequipped = 0;

  for (const prog of progresses) {
    const jobBadge = prog.equipment?.job_eq;
    if (!jobBadge) continue;

    console.log(`拆下 ${prog.playerId} 的職業徽章：${jobBadge.itemName}`);

    if (!isDryRun) {
      // 移到背包
      const inventory = Array.isArray(prog.inventory) ? prog.inventory : [];
      inventory.push(jobBadge);

      // 從裝備欄移除
      const equipment = { ...prog.equipment };
      delete equipment.job_eq;

      // 保存
      await db.collection("progress").updateOne(
        { _id: prog._id },
        {
          $set: {
            inventory,
            equipment,
            updatedAt: new Date().toISOString()
          }
        }
      );
    }
    unequipped++;
  }

  console.log(`\n拆卸完成：${unequipped} 位玩家的職業徽章已移到背包`);
  if (isDryRun) {
    console.log("(dry-run，未實際寫入)");
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
