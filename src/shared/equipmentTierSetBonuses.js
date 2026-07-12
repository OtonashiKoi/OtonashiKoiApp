"use strict";

// 階級套裝（D/C/B/A）：按身上「同階裝備件數」給通用加成，與具名套裝(equipmentSetBonuses.js)「同時生效、疊加」。
// 一件裝備會同時計入「它的階級套」與「它的具名套」——兩邊都吃到。

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

// 階級套裝加成表：同階達門檻件數即累加（達高門檻亦享低門檻）。門檻 3/5/7（對齊具名套裝）。
// A 階這排＝舊「A 階套裝特效」（最終傷/對Boss/掉落），本次「改回去」。
const TIER_SET_TIERS = {
  D: [
    { count: 3, desc: "STR/INT/DEX +1", stats: { str: 1, int: 1, dex: 1 } },
    { count: 5, desc: "金幣 +8%", goldPct: 8 },
    { count: 7, desc: "EXP +8%", expPct: 8 }
  ],
  C: [
    { count: 3, desc: "命中 +8%", hitPct: 8 },
    { count: 5, desc: "迴避 +8%", dodgePct: 8 },
    { count: 7, desc: "傷害 +6%", damagePct: 6 }
  ],
  B: [
    { count: 3, desc: "傷害 +6%", damagePct: 6 },
    { count: 5, desc: "爆擊率 +5%", critRatePct: 5 },
    { count: 7, desc: "爆擊傷害 +10%", critDamagePct: 10 }
  ],
  A: [
    { count: 3, desc: "最終傷害 +5%", finalDamagePct: 5 },
    { count: 5, desc: "對 Boss 傷害 +10%", bossDamagePct: 10 },
    { count: 7, desc: "掉落率 +10%", dropPct: 10 }
  ]
};

const NUMERIC_KEYS = [
  "hitPct", "dodgePct", "critRatePct", "critDamagePct",
  "damagePct", "finalDamagePct", "bossDamagePct", "goldPct", "expPct", "dropPct"
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

// 身上各階裝備件數。與具名套裝「同時計入」：不再排除帶 setKey 的件（一件同時算階級套與具名套）。
function countEquippedTiers(equipped = {}) {
  const counts = { D: 0, C: 0, B: 0, A: 0 };
  if (!equipped || typeof equipped !== "object") return counts;

  for (const slot of TIER_SET_SLOTS) {
    const it = equipped?.[slot];
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

  for (const [tier, count] of Object.entries(tierCounts)) {
    for (const t of (TIER_SET_TIERS[tier] || [])) {
      if (count < t.count) continue;
      if (t.stats) { for (const s of ["str", "int", "dex"]) bonuses.stats[s] += (t.stats[s] || 0); }
      for (const k of NUMERIC_KEYS) if (t[k]) bonuses[k] += t[k];
    }
  }

  return bonuses;
}

// 顯示用：回傳身上各階級套的進度（含每 tier 文字與是否達成）。只列有裝到的階。
function getTierSetInfo(equipped = {}) {
  const tierCounts = countEquippedTiers(equipped);
  const out = [];
  const LABEL = { D: "D 階套裝", C: "C 階套裝", B: "B 階套裝", A: "A 階套裝" };
  for (const tier of ["D", "C", "B", "A"]) {
    const count = tierCounts[tier] || 0;
    if (count <= 0) continue;
    out.push({
      tier,
      name: LABEL[tier],
      count,
      tiers: (TIER_SET_TIERS[tier] || []).map((t) => ({ count: t.count, desc: t.desc, active: count >= t.count }))
    });
  }
  return out;
}

module.exports = {
  TIER_SET_SLOTS,
  TIER_SET_TIERS,
  countEquippedTiers,
  getEquipmentTierSetBonuses,
  getTierSetInfo,
  EMPTY_BONUSES
};
