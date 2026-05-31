"use strict";
/**
 * 給指定玩家：等級 40 + 所有道具各一份（已擁有的 itemId 跳過）
 * 用法：PLAYER_ID=<discordId> node scripts/grant-all-to-player.js
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const PLAYER_ID = process.env.PLAYER_ID || process.argv[2];
const TARGET_LEVEL = 40;
const NOW = new Date().toISOString();

function buildInventoryEntry(item) {
  return {
    uuid: crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    name: item.name,
    itemEffect: item.effect || { type: "none", value: 0 },
    useEffects: item.useEffects || [],
    passiveEffects: item.passiveEffects || [],
    procEffects: item.procEffects || [],
    combatEffects: item.combatEffects || [],
    itemType: item.itemType || null,
    imageUrl: item.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || null,
    equipStats: item.equipStats || null,
    weaponType: item.weaponType || null,
    isTwoHanded: !!item.isTwoHanded,
    atkStat: item.atkStat || null,
    tier: item.tier || null,
    monsterCardSkill: item.monsterCardSkill || null,
    enhanceLevel: 0,
    source: "admin_grant",
    purchasedAt: NOW,
  };
}

async function main() {
  if (!PLAYER_ID) {
    console.error("Usage: PLAYER_ID=<discordId> node scripts/grant-all-to-player.js");
    process.exit(1);
  }
  const db = await getMongoDb();
  const progress = await db.collection("progress").findOne({ playerId: PLAYER_ID });
  if (!progress) {
    console.error(`[ERR] 找不到玩家 progress (playerId=${PLAYER_ID})`);
    process.exit(1);
  }
  console.log(`[INFO] 玩家現況：level=${progress.level}, exp=${progress.exp}, inv=${(progress.inventory||[]).length} 件`);

  // 撈所有 items
  const items = await db.collection("items").find({}).toArray();
  console.log(`[INFO] items collection 共 ${items.length} 筆`);

  // 已擁有的 itemId set（含 inventory + equipment）
  const ownedIds = new Set();
  for (const e of (progress.inventory || [])) if (e?.itemId) ownedIds.add(e.itemId);
  for (const e of Object.values(progress.equipment || {})) if (e?.itemId) ownedIds.add(e.itemId);
  console.log(`[INFO] 已擁有 ${ownedIds.size} 種道具`);

  // 組要新增的 entries
  const toAdd = [];
  let skipped = 0;
  for (const item of items) {
    if (!item.id) { skipped++; continue; }
    if (ownedIds.has(item.id)) { skipped++; continue; }
    toAdd.push(buildInventoryEntry(item));
  }
  console.log(`[INFO] 將新增 ${toAdd.length} 件，跳過 ${skipped} 件（已擁有或無 id）`);

  // 寫入：level=40, exp=0, push entries
  const newInventory = [...(progress.inventory || []), ...toAdd];
  const updateRes = await db.collection("progress").updateOne(
    { playerId: PLAYER_ID },
    { $set: { level: TARGET_LEVEL, exp: 0, inventory: newInventory, updatedAt: NOW } }
  );
  console.log(`[OK] 更新結果：matched=${updateRes.matchedCount}, modified=${updateRes.modifiedCount}`);

  const after = await db.collection("progress").findOne({ playerId: PLAYER_ID });
  console.log(`[OK] 玩家現況：level=${after.level}, exp=${after.exp}, inv=${(after.inventory||[]).length} 件`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
