"use strict";
/**
 * 測試用：給指定玩家「每種裝備各 1 件(只補缺的)」+ 各階強化寶石 100 顆(D/C/B/A/S)。
 * 用法：node scripts/grant-all-equipment-test.js <discordId>
 */
require("dotenv").config();
const crypto = require("crypto");

const PID = process.argv[2] || "865264891991425055";
const GEM_PER_TIER = 100;

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const { ENHANCE_GEMS } = require("../src/shared/enhanceConfig");
  const { addEnhanceGemToInventory } = require("../src/shared/inventoryStacking");
  const db = await getMongoDb();

  const prog = await db.collection("progress").findOne({ playerId: PID });
  if (!prog) { console.error("找不到玩家", PID); process.exit(1); }
  const inv = Array.isArray(prog.inventory) ? prog.inventory.map((e) => ({ ...e })) : [];
  const haveIds = new Set(inv.map((e) => e.itemId).filter(Boolean));

  // 1) 每種裝備補 1 件(只補目前沒有的)
  const equips = await db.collection("items").find({ itemType: "equipment" }).toArray();
  let added = 0;
  for (const it of equips) {
    if (haveIds.has(it.id)) continue;
    inv.push({
      uuid: crypto.randomUUID(), itemId: it.id, itemName: it.name,
      itemEffect: it.effect || { type: "none", value: 0 },
      useEffects: it.useEffects || [], passiveEffects: it.passiveEffects || [],
      procEffects: it.procEffects || [], combatEffects: it.combatEffects || [],
      itemType: it.itemType || "equipment",
      imageUrl: it.imageUrl || null, imageThumbnailUrl: it.imageThumbnailUrl || null,
      equipSlot: it.equipSlot || null, equipStats: it.equipStats ? { ...it.equipStats } : {},
      weaponType: it.weaponType || null, isTwoHanded: it.isTwoHanded || false,
      atkStat: it.atkStat || null, tier: it.tier || null, monsterCardSkill: it.monsterCardSkill || null,
      enhanceLevel: 0, source: "admin_test_grant", purchasedAt: new Date().toISOString(),
    });
    added++;
  }

  // 2) 各階強化寶石 100 顆(stack)
  const gemReport = [];
  for (const [tier, gemId] of Object.entries(ENHANCE_GEMS)) {
    const gemItem = await db.collection("items").findOne({ id: gemId });
    if (!gemItem) { gemReport.push(`${tier}:❌找不到寶石道具`); continue; }
    const ok = addEnhanceGemToInventory(inv, gemItem, GEM_PER_TIER, { source: "admin_test_grant" });
    gemReport.push(`${tier}階×${GEM_PER_TIER}${ok ? "" : "(失敗)"}`);
  }

  await db.collection("progress").updateOne(
    { playerId: PID },
    { $set: { inventory: inv, updatedAt: new Date().toISOString() } }
  );

  console.log(`玩家 ${PID}:`);
  console.log(`  裝備補發 ${added} 件(每種 1 件,共 ${equips.length} 種裝備)`);
  console.log(`  強化寶石：${gemReport.join("、")}`);
  console.log(`  背包件數：${(prog.inventory || []).length} → ${inv.length}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
