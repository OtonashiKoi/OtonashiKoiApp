"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

// 孤兒 itemId → 新 itemId 對照表（依名稱比對）
const ID_MAP = {
  "994e98ed-6bf0-4bdd-a191-f06dcd00b448": "a56bd609-cf0b-4924-b724-891f221fc0b9", // 木製單手劍
  "382ec10e-ca1f-4b82-9a0b-ff18924247f5": "b7f5ef58-79d3-41ef-b9d2-c726da22417b", // 音無 哭哭 錢錢飛走了
  "2669493c-bd86-4cb0-ab01-50e9f514cc1a": "c5db63c0-79f2-452a-a076-78f09093a65c", // 音無2025年1月新年會限圖
  "deaa9915-3c68-4a30-8f8c-ef2d3c495c61": "9d3f8e8a-3de6-40c4-a2a5-06793e83c7d5", // 【鯉民】的每月俸祿
};

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");

  const allProgress = await db.collection("progress").find({}).toArray();
  let updatedPlayers = 0, updatedEntries = 0;

  for (const progress of allProgress) {
    let dirty = false;

    // 背包
    if (Array.isArray(progress.inventory)) {
      for (const entry of progress.inventory) {
        const newId = ID_MAP[entry.itemId];
        if (newId) {
          console.log(`  [背包] ${progress.playerId} | ${entry.itemName} | ${entry.itemId} → ${newId}`);
          entry.itemId = newId;
          dirty = true;
          updatedEntries++;
        }
      }
    }

    // 裝備槽
    if (progress.equipment && typeof progress.equipment === "object") {
      for (const slot of Object.keys(progress.equipment)) {
        const entry = progress.equipment[slot];
        if (!entry) continue;
        const newId = ID_MAP[entry.itemId];
        if (newId) {
          console.log(`  [裝備槽:${slot}] ${progress.playerId} | ${entry.itemName} | ${entry.itemId} → ${newId}`);
          progress.equipment[slot] = { ...entry, itemId: newId };
          dirty = true;
          updatedEntries++;
        }
      }
    }

    if (dirty) {
      progress.updatedAt = new Date().toISOString();
      await db.collection("progress").replaceOne({ _id: progress._id }, progress);
      updatedPlayers++;
    }
  }

  console.log(`\n完成：更新 ${updatedPlayers} 位玩家，共 ${updatedEntries} 筆 itemId`);
  await client.close();
})();
