"use strict";

// 武器主屬性的攻擊收益：前期每點 1.25，有感成長；30 點後平滑遞減。
// 超過 30 點後的邊際收益為 1.25 / (1 + (raw - 30) / 35)，不會突然斷崖或封死成長。
const EARLY_MULTIPLIER = 1.25;
const SOFT_CAP = 30;
const TAIL_SCALE = 35;

function effectiveOffensiveStat(rawValue) {
  const raw = Math.max(0, Number(rawValue) || 0);
  if (raw <= SOFT_CAP) return raw * EARLY_MULTIPLIER;
  return EARLY_MULTIPLIER * (SOFT_CAP + TAIL_SCALE * Math.log1p((raw - SOFT_CAP) / TAIL_SCALE));
}

function offensiveStatGain(before, after) {
  return effectiveOffensiveStat(after) - effectiveOffensiveStat(before);
}

module.exports = { effectiveOffensiveStat, offensiveStatGain };
