"use strict";

/**
 * fix-enhance-equipment-stats.js
 *
 * 修正所有強化裝備的 equipStats
 * 執行：node scripts/fix-enhance-equipment-stats.js
 * 加 --dry-run 只列印不寫入
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const isDryRun = process.argv.includes("--dry-run");

// 強化加值規則（與 enhanceService.enhanceEquipment() 一致）
const WEAPON_ENHANCE_BONUS = { D: 1, C: 1.5, B: 2, A: 2 };
const ARMOR_ENHANCE_VIT = { D: 1, C: 2, B: 3, A: 3 };

function getLibraryItemMap(items) {
  const map = {};
  items.forEach(i => { map[i.id] = i; });
  return map;
}

function recalculateEquipStats(equipment, libItem) {
  if (!equipment || !libItem || !libItem.equipStats) return equipment.equipStats;

  const baseStats = { ...libItem.equipStats };
  const enhanceLevel = Math.max(0, Number(equipment.enhanceLevel) || 0);

  if (enhanceLevel === 0) return baseStats;

  // 找主屬性
  const entries = Object.entries(baseStats);
  if (entries.length === 0) return baseStats;

  const [mainStat] = entries.sort((a, b) => b[1] - a[1])[0];
  const tier = String(equipment.tier || "").toUpperCase();
  const isWeapon = equipment.equipSlot === "weapon" || equipment.equipSlot === "shield";

  let delta = 1;
  if (isWeapon) {
    delta = WEAPON_ENHANCE_BONUS[tier] ?? 1;
  } else {
    delta = ARMOR_ENHANCE_VIT[tier] ?? 1;
  }

  const newStats = { ...baseStats };
  newStats[mainStat] = Number(((baseStats[mainStat] || 0) + delta * enhanceLevel).toFixed(2));

  return newStats;
}

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);

  // 取得所有 library items
  const items = await db.collection("items").find({}).toArray();
  const libMap = getLibraryItemMap(items);

  const progresses = await db.collection("progress").find({}).toArray();

  let fixed = 0;
  let errors = 0;

  for (const prog of progresses) {
    const playerId = prog.playerId;
    const inventory = prog.inventory || [];
    const equipment = prog.equipment || {};

    // 檢查背包
    for (let i = 0; i < inventory.length; i++) {
      const item = inventory[i];
      if (!item || !item.enhanceLevel || item.enhanceLevel === 0) continue;

      const libItem = libMap[item.itemId];
      if (!libItem) {
        console.warn(`⚠ 找不到 itemId=${item.itemId} 的 library item (玩家 ${playerId})`);
        errors++;
        continue;
      }

      const newStats = recalculateEquipStats(item, libItem);
      const oldStatsStr = JSON.stringify(item.equipStats || {});
      const newStatsStr = JSON.stringify(newStats);

      if (oldStatsStr !== newStatsStr) {
        console.log(
          `修正 ${item.itemName} +${item.enhanceLevel}: ${oldStatsStr} → ${newStatsStr}`
        );
        if (!isDryRun) {
          inventory[i].equipStats = newStats;
        }
        fixed++;
      }
    }

    // 檢查穿戴的裝備
    for (const [slot, item] of Object.entries(equipment)) {
      if (!item || !item.enhanceLevel || item.enhanceLevel === 0) continue;

      const libItem = libMap[item.itemId];
      if (!libItem) {
        console.warn(`⚠ 找不到 itemId=${item.itemId} 的 library item (玩家 ${playerId})`);
        errors++;
        continue;
      }

      const newStats = recalculateEquipStats(item, libItem);
      const oldStatsStr = JSON.stringify(item.equipStats || {});
      const newStatsStr = JSON.stringify(newStats);

      if (oldStatsStr !== newStatsStr) {
        console.log(
          `修正 ${item.itemName} +${item.enhanceLevel} (${slot}): ${oldStatsStr} → ${newStatsStr}`
        );
        if (!isDryRun) {
          equipment[slot].equipStats = newStats;
        }
        fixed++;
      }
    }

    // 保存該玩家
    if (fixed > 0 && !isDryRun) {
      prog.updatedAt = new Date().toISOString();
      await db.collection("progress").updateOne(
        { _id: prog._id },
        {
          $set: {
            inventory: prog.inventory,
            equipment: prog.equipment,
            updatedAt: prog.updatedAt
          }
        }
      );
    }
  }

  console.log(`\n修正完成：${fixed} 件裝備已更正`);
  if (errors > 0) {
    console.warn(`⚠ 發現 ${errors} 個錯誤（找不到 library item）`);
  }
  if (isDryRun) {
    console.log("(dry-run，未實際寫入)");
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
