"use strict";
const { encounterCount } = require('../../shared/encounterGroup');

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
  const base = Math.max(1, Math.round(Number(monster?.calc?.maxHp) || 1)) * encounterCount(state, monster);
  if (Number(state?.coopHpMonsterSeq) !== Number(monster?.seq)) return base;
  return Math.max(base, Math.round(Number(state?.coopMaxHp) || base));
}

function scaleNormalMonster(state, monster, damageMap) {
  const oldMax = normalMaxHp(state, monster);
  const base = Math.max(1, Math.round(Number(monster?.calc?.maxHp) || 1)) * encounterCount(state, monster);
  const count = Math.min(5, Math.max(1, eligibleCount(damageMap)));
  const enemies = encounterCount(state, monster);
  const newMax = Math.max(oldMax, Math.round(base / enemies * HP_MULTIPLIERS[count]) * enemies);
  const oldHp = Math.max(0, Math.min(oldMax, Number(state?.currentHp ?? oldMax) || 0));
  return {
    coopHpMonsterSeq: monster.seq,
    coopMaxHp: newMax,
    // Expand only living segments; joining players must never revive defeated enemies.
    currentHp: oldHp + require('../../shared/encounterGroup').remaining(oldHp, oldMax / enemies, enemies)
      * (newMax - oldMax) / enemies,
  };
}

module.exports = { eligibleCount, normalExpMultiplier, normalMaxHp, scaleNormalMonster };
