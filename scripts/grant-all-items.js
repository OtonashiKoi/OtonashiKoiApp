"use strict";
/**
 * 把道具庫所有道具各發 1 份給指定玩家（背包）。
 * 已擁有（同 itemId）者跳過 → 確保「一份」、可重跑不疊加。
 *
 * 用法： node scripts/grant-all-items.js <discordId>
 */
require("dotenv").config();
const crypto = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const TARGET = process.argv[2] || "865264891991425055";

function toInventoryEntry(item) {
  return {
    uuid: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    itemEffect: item.effect || { type: "none", value: 0 },
    useEffects: item.useEffects || [],
    passiveEffects: item.passiveEffects || [],
    procEffects: item.procEffects || [],
    combatEffects: item.combatEffects || [],
    itemType: item.itemType || "consumable",
    imageUrl: item.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || null,
    equipStats: item.equipStats || null,
    weaponType: item.weaponType || null,
    isTwoHanded: item.isTwoHanded || false,
    atkStat: item.atkStat || null,
    tier: item.tier || null,
    monsterCardSkill: item.monsterCardSkill || null,
    enhanceLevel: 0,
    stackCount: 1,
    source: "admin_grant_all",
    purchasedAt: new Date().toISOString()
  };
}

async function main() {
  const db = await getMongoDb();
  const prog = await db.collection("progress").findOne({ playerId: TARGET });
  if (!prog) { console.error("❌ 找不到 progress，playerId=" + TARGET); process.exit(1); }

  const items = await db.collection("items").find({}).toArray();
  const inv = Array.isArray(prog.inventory) ? prog.inventory : [];
  const ownedIds = new Set(inv.map((e) => e.itemId));

  let added = 0, skipped = 0;
  for (const item of items) {
    if (!item.id) { continue; }
    if (ownedIds.has(item.id)) { skipped++; continue; }
    inv.push(toInventoryEntry(item));
    ownedIds.add(item.id);
    added++;
  }

  await db.collection("progress").updateOne(
    { playerId: TARGET },
    { $set: { inventory: inv, updatedAt: new Date().toISOString() } }
  );
  console.log(`目標 ${TARGET}：道具庫 ${items.length} 件 → 新增 ${added}、已擁有跳過 ${skipped}、背包現共 ${inv.length} 件`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
