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
    const tier = String(equipped?.[slot]?.tier || "").toUpperCase();
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

  if (tierCounts.D >= 3) {
    bonuses.stats.str += 3;
    bonuses.stats.int += 3;
    bonuses.stats.dex += 3;
  }
  if (tierCounts.D >= 5) bonuses.goldPct += 10;
  if (tierCounts.D >= 7) bonuses.expPct += 10;

  if (tierCounts.C >= 3) bonuses.dodgePct += 10;
  if (tierCounts.C >= 5) bonuses.damagePct += 5;
  if (tierCounts.C >= 7) bonuses.hitPct += 15;

  if (tierCounts.B >= 3) bonuses.damagePct += 10;
  if (tierCounts.B >= 5) bonuses.critRatePct += 5;
  if (tierCounts.B >= 7) bonuses.critDamagePct += 10;

  if (tierCounts.A >= 3) bonuses.finalDamagePct += 5;
  if (tierCounts.A >= 5) bonuses.bossDamagePct += 10;
  if (tierCounts.A >= 7) bonuses.dropPct += 10;

  return bonuses;
}

module.exports = {
  TIER_SET_SLOTS,
  countEquippedTiers,
  getEquipmentTierSetBonuses,
  EMPTY_BONUSES
};
