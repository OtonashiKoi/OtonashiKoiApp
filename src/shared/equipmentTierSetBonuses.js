"use strict";

const TIER_SET_SLOTS = [
  "weapon",
  "shield",
  "head_top",
  "head_mid",
  "head_low",
  "armor",
  "garment",
  "shoes",
  "accessory_l",
  "accessory_r"
];

const EMPTY_BONUSES = Object.freeze({
  tierCounts: Object.freeze({ D: 0, C: 0, B: 0, A: 0 }),
  stats: Object.freeze({ str: 0, int: 0, dex: 0 }),
  hitPct: 0,
  dodgePct: 0,
  critRatePct: 0,
  critDamagePct: 0,
  damagePct: 0,
  finalDamagePct: 0,
  bossDamagePct: 0,
  goldPct: 0,
  expPct: 0,
  dropPct: 0
});

function countEquippedTiers(equipped = {}) {
  const counts = { D: 0, C: 0, B: 0, A: 0 };
  if (!equipped || typeof equipped !== "object") return counts;

  for (const slot of TIER_SET_SLOTS) {
    const it = equipped?.[slot];
    // 帶 setKey/setKeys 的件歸具名套裝，不併入階級套裝計數（避免雙算）
    if (it && (it.setKey || (Array.isArray(it.setKeys) && it.setKeys.length))) continue;
    const tier = String(it?.tier || "").toUpperCase();
    if (tier in counts) counts[tier] += 1;
  }
  return counts;
}

function getEquipmentTierSetBonuses(equipped = {}) {
  const tierCounts = countEquippedTiers(equipped);
  const bonuses = {
    tierCounts,
    stats: { str: 0, int: 0, dex: 0 },
    hitPct: 0,
    dodgePct: 0,
    critRatePct: 0,
    critDamagePct: 0,
    damagePct: 0,
    finalDamagePct: 0,
    bossDamagePct: 0,
    goldPct: 0,
    expPct: 0,
    dropPct: 0
  };

  // D/C/B/A 通用「階級套裝」加成已停用：階級(D/C/B/A)只作為裝備品階顯示，
  // 所有套裝加成一律改由「具名套裝」提供（秘銀套/火焰套…見 equipmentSetBonuses.js）。
  // tierCounts 仍保留供顯示/統計用途。

  return bonuses;
}

module.exports = {
  TIER_SET_SLOTS,
  countEquippedTiers,
  getEquipmentTierSetBonuses,
  EMPTY_BONUSES
};
