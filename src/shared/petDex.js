"use strict";
/**
 * 寵物圖鑑收集（Model A：品種 × 位階）。
 * - 登錄鍵：`${petId}:${位階}`（D/C/B/A），孵到就永久登錄（存 progress.petDex）。
 * - 收集分數：每格依位階加權（D1/C2/B4/A8）；每品種滿分 15，全收集分數 = 品種數 × 15。
 * - 里程碑（占滿分 %）：解鎖採集/小屬性永久加成（全域，不需出戰該寵物）。階梯式＝取最高、不疊加。
 */
const RARITY_SCORE = { D: 1, C: 2, B: 4, A: 8 };
const PET_TIERS = ["D", "C", "B", "A"];
const PER_SPECIES_MAX = PET_TIERS.reduce((s, t) => s + (RARITY_SCORE[t] || 0), 0); // 15

// 里程碑：score=達到收集分數才解鎖（絕對值，免查品種數即可算加成）。
// 目前 15 品種 → 滿分 225（每品種 15）。獎勵：gatherPct(採集量%)、gatherSpeedPct(採集速度%)、statBonus(全屬性+)、title(全收集稱號)。
const DEX_MILESTONES = [
  { score: 45, label: "採集量 +5%", gatherPct: 5 },
  { score: 90, label: "採集速度 +10%", gatherSpeedPct: 10 },
  { score: 150, label: "採集量 +10%、全屬性 +2", gatherPct: 10, statBonus: 2 },
  { score: 225, label: "🏅 馴獸大師：採集量 +15%、全屬性 +5", gatherPct: 15, statBonus: 5, title: true },
];

function scoreOf(petDex) {
  if (!petDex || typeof petDex !== "object") return 0;
  let s = 0;
  for (const key of Object.keys(petDex)) {
    const tier = String(key.split(":")[1] || "").toUpperCase();
    s += RARITY_SCORE[tier] || 0;
  }
  return s;
}

/** 由 petDex + 品種總數算出收集狀態與已解鎖的永久加成。 */
function computeDexBonuses(petDex, totalSpecies = 0) {
  const score = scoreOf(petDex);
  const maxScore = Math.max(1, Number(totalSpecies) * PER_SPECIES_MAX);
  const collected = petDex && typeof petDex === "object" ? Object.keys(petDex).length : 0;
  const totalSlots = Number(totalSpecies) * PET_TIERS.length;
  const pct = (score / maxScore) * 100;
  const unlocked = DEX_MILESTONES.filter((m) => score >= m.score);
  const bonus = { gatherPct: 0, gatherSpeedPct: 0, statBonus: 0, title: false };
  for (const m of unlocked) { // 階梯：取最高，不累加
    bonus.gatherPct = Math.max(bonus.gatherPct, m.gatherPct || 0);
    bonus.gatherSpeedPct = Math.max(bonus.gatherSpeedPct, m.gatherSpeedPct || 0);
    bonus.statBonus = Math.max(bonus.statBonus, m.statBonus || 0);
    if (m.title) bonus.title = true;
  }
  return { score, maxScore, collected, totalSlots, pct: Math.round(pct), bonus, unlockedCount: unlocked.length };
}

module.exports = { RARITY_SCORE, PET_TIERS, PER_SPECIES_MAX, DEX_MILESTONES, scoreOf, computeDexBonuses };
