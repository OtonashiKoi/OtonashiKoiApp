#!/usr/bin/env node
"use strict";

/**
 * 遷移腳本：合併玩家背包中重複的爬塔藥水條目
 * 用法: node scripts/migrate-tower-potion-stacking.js
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const TOWER_POTION_IDS = new Set([
  "f56aefd0-faa8-45b5-8451-fbbae5810c74", // 回復藥水（小）
  "97fbd546-e207-4130-b130-2fadd799703a", // 回復藥水（中）
  "3eb1d302-3d04-40a5-8335-1f9ed844dc27", // 回復藥水（大）
  "12bfb110-6489-4784-8537-f3f496759f8f", // 復活藥水（小）
  "c4794326-ced1-4efe-983d-17c14ee2f2f8", // 復活藥水（大）
]);

async function main() {
  const db = await getMongoDb();
  const progressCollection = db.collection("progress");

  console.log("開始掃描玩家背包中的爬塔藥水...");

  const cursor = progressCollection.find({ inventory: { $exists: true, $type: "array" } });

  let scanned = 0;
  let modified = 0;
  let merged = 0;

  for await (const doc of cursor) {
    if (!Array.isArray(doc.inventory)) continue;

    const potions = {};
    const others = [];

    for (const item of doc.inventory) {
      if (item?.itemId && TOWER_POTION_IDS.has(item.itemId)) {
        if (!potions[item.itemId]) {
          potions[item.itemId] = { sample: item, count: 0 };
        }
        potions[item.itemId].count += Math.max(1, Number(item.stackCount) || 1);
      } else {
        others.push(item);
      }
    }

    // 只有存在多個相同藥水才需要更新
    const needsMerge = Object.values(potions).some((g) => g.count > 1 || doc.inventory.filter((i) => i?.itemId === g.sample.itemId).length > 1);
    if (!needsMerge) { scanned++; continue; }

    const newInventory = [...others];
    for (const { sample, count } of Object.values(potions)) {
      newInventory.push({ ...sample, stackCount: count });
      merged += doc.inventory.filter((i) => i?.itemId === sample.itemId).length - 1;
    }

    await progressCollection.updateOne(
      { _id: doc._id },
      { $set: { inventory: newInventory, updatedAt: new Date().toISOString() } }
    );
    modified++;
    scanned++;

    if (scanned % 50 === 0) console.log(`已處理 ${scanned} 名玩家...`);
  }

  console.log(`\n✅ 遷移完成！`);
  console.log(`   掃描玩家數：${scanned}`);
  console.log(`   修改玩家數：${modified}`);
  console.log(`   合併藥水條目：${merged}`);
  process.exit(0);
}

main().catch((e) => { console.error("❌ 失敗：", e); process.exit(1); });
