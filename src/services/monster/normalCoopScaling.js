"use strict";

const HP_MULTIPLIERS = [1, 1, 1.5, 2, 2.4, 2.8];
const EXP_MULTIPLIERS = [1, 1, 1, 1.6, 1.9, 2.2, 2.5];

function eligibleCount(damageMap = {}) {
  return Object.values(damageMap).filter((entry) =>
    Number(entry?.damage) > 0 || Number(entry?.assist) > 0).length;
}

function normalExpMultiplier(count) {
  return EXP_MULTIPLIERS[Math.min(6, Math.max(1, Math.floor(Number(count) || 1)))];
}

function normalMaxHp(state, monster) {
  if (!monster) return 0;
  const base = Math.max(1, Math.round(Number(monster?.calc?.maxHp) || 1));
  if (Number(state?.coopHpMonsterSeq) !== Number(monster?.seq)) return base;
  return Math.max(base, Math.round(Number(state?.coopMaxHp) || base));
}

function scaleNormalMonster(state, monster, damageMap) {
  const oldMax = normalMaxHp(state, monster);
  const base = Math.max(1, Math.round(Number(monster?.calc?.maxHp) || 1));
  const count = Math.min(5, Math.max(1, eligibleCount(damageMap)));
  const newMax = Math.max(oldMax, Math.round(base * HP_MULTIPLIERS[count]));
  const oldHp = Math.max(0, Math.min(oldMax, Number(state?.currentHp ?? oldMax) || 0));
  return {
    coopHpMonsterSeq: monster.seq,
    coopMaxHp: newMax,
    currentHp: oldHp + newMax - oldMax,
  };
}

module.exports = { eligibleCount, normalExpMultiplier, normalMaxHp, scaleNormalMonster };
