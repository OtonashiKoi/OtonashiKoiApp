"use strict";
/**
 * 把指定玩家換成「戰士/雙手斧」跑分 build:屠龍巨斧 + 戰士徽章 + 清空卡片 + 對齊跑分屬性(str180/其餘60)。
 * 防具維持原本 +5A 不動。舊裝備/卡片退回背包,舊屬性印出可還原。
 */
require("dotenv").config();
const crypto = require("crypto");

const PID = process.argv[2] || "865264891991425055";
const WEAPON_ID = "8c1782df-9823-405c-ade8-423c854a467e"; // 秘銀雙手斧(A 階 axe_2h)
const BADGE_ID = "job_warrior_v1";
const WEAPON_ENHANCE_LEVEL = 5;       // A+5
const WEAPON_ENHANCE_PER_LV_A = 2;    // A 階武器:每級主屬性 +2
const NEW_ATTRS = { str: 180, agi: 60, vit: 60, int: 60, dex: 60, luk: 60 };

function equippedFromItem(it) {
  return {
    uuid: crypto.randomUUID(), itemId: it.id, itemName: it.name,
    itemType: it.itemType || "equipment", equipSlot: it.equipSlot || null,
    equipStats: it.equipStats ? { ...it.equipStats } : {},
    weaponType: it.weaponType || null, isTwoHanded: it.isTwoHanded || false,
    atkStat: it.atkStat || null, tier: it.tier || null,
    passiveEffects: it.passiveEffects || [], combatEffects: it.combatEffects || [],
    procEffects: it.procEffects || [], monsterCardSkill: it.monsterCardSkill || null,
    jobSkills: it.jobSkills || null, effect: it.effect || { type: "none", value: 0 },
    imageUrl: it.imageUrl || null, imageThumbnailUrl: it.imageThumbnailUrl || null,
    enhanceLevel: 0,
  };
}

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const p = await db.collection("progress").findOne({ playerId: PID });
  if (!p) { console.error("找不到玩家", PID); process.exit(1); }

  const axe = await db.collection("items").findOne({ id: WEAPON_ID });
  const badge = await db.collection("items").findOne({ id: BADGE_ID });
  if (!axe || !badge) { console.error("找不到武器或徽章"); process.exit(1); }

  const eq = { ...(p.equipment || {}) };
  const inv = Array.isArray(p.inventory) ? p.inventory.map((e) => ({ ...e })) : [];

  // 舊的 weapon / job_eq / 卡片退回背包(避免遺失)
  const report = [];
  for (const slot of ["weapon", "job_eq", "special_1", "special_2", "special_3"]) {
    const old = eq[slot];
    if (old) {
      inv.push({ ...old, source: "bench_swap_return", purchasedAt: new Date().toISOString() });
      report.push(`  ${slot}: ${old.itemName || old.name || "-"} → 退回背包`);
    }
  }

  // 換上武器(A 階斧 +5,主屬性烘入)+ 徽章,清空卡片
  const weaponEq = equippedFromItem(axe);
  const mainStat = axe.atkStat || "str";
  weaponEq.equipStats[mainStat] = (Number(weaponEq.equipStats[mainStat]) || 0) + WEAPON_ENHANCE_PER_LV_A * WEAPON_ENHANCE_LEVEL;
  weaponEq.enhanceLevel = WEAPON_ENHANCE_LEVEL;
  eq.weapon = weaponEq;
  eq.job_eq = equippedFromItem(badge);
  eq.special_1 = null; eq.special_2 = null; eq.special_3 = null;

  const oldAttrs = p.attributes || {};
  await db.collection("progress").updateOne(
    { playerId: PID },
    { $set: { equipment: eq, inventory: inv, attributes: NEW_ATTRS, updatedAt: new Date().toISOString() } }
  );

  console.log(`玩家 ${PID} 換成「戰士/雙手斧」跑分 build:`);
  console.log("退回背包的舊裝/卡:");
  report.forEach((r) => console.log(r));
  console.log("換上:");
  console.log(`  weapon: ${axe.name}(${axe.tier}) +${WEAPON_ENHANCE_LEVEL}  equipStats=${JSON.stringify(weaponEq.equipStats)}`);
  console.log(`  job_eq: 戰士徽章`);
  console.log(`  special_1/2/3: 清空(職業本身,不掛卡)`);
  console.log(`  防具: 維持原本 +5A 不動`);
  console.log(`屬性: ${JSON.stringify(oldAttrs)} → ${JSON.stringify(NEW_ATTRS)}`);
  console.log(`(如只要換裝不要動屬性,還原指令:把 attributes 改回 ${JSON.stringify(oldAttrs)})`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
