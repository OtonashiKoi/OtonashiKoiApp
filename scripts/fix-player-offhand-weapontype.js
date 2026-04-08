"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

// itemId → 正確 weaponType 對照表（從 items 集合讀取）
async function buildWeaponTypeMap(db) {
  const items = await db.collection("items").find(
    { equipSlot: "shield", weaponType: { $ne: null } }
  ).toArray();
  const map = {};
  for (const i of items) map[i.id] = i.weaponType;
  return map;
}

(async () => {
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);

  const weaponTypeMap = await buildWeaponTypeMap(db);
  console.log("副手武器 id→weaponType map:", weaponTypeMap);

  const players = await db.collection("progress").find({}).toArray();
  let totalFixed = 0;

  for (const p of players) {
    let dirty = false;

    // 修背包
    if (Array.isArray(p.inventory)) {
      for (const entry of p.inventory) {
        if (entry.equipSlot === "shield" && entry.weaponType == null && weaponTypeMap[entry.itemId]) {
          entry.weaponType = weaponTypeMap[entry.itemId];
          dirty = true;
          console.log(`  [背包] ${p.discordId} → ${entry.itemName} weaponType=${entry.weaponType}`);
        }
      }
    }

    // 修裝備欄
    if (p.equipment && p.equipment.shield) {
      const slot = p.equipment.shield;
      if (slot.equipSlot === "shield" && slot.weaponType == null && weaponTypeMap[slot.itemId]) {
        slot.weaponType = weaponTypeMap[slot.itemId];
        dirty = true;
        console.log(`  [裝備] ${p.discordId} → ${slot.itemName} weaponType=${slot.weaponType}`);
      }
    }

    if (dirty) {
      await db.collection("progress").updateOne({ _id: p._id }, { $set: { inventory: p.inventory, equipment: p.equipment, updatedAt: new Date().toISOString() } });
      totalFixed++;
    }
  }

  console.log("修正完成，共更新", totalFixed, "位玩家");
  await c.close();
})().catch(console.error);
