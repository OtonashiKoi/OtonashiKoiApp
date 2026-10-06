"use strict";
const { encounterCount } = require('../../shared/encounterGroup');

// Monster HP follows the template and encounter count, never player count.
// Retained for party-tower rewards; normal-map EXP uses a per-player share.
const EXP_MULTIPLIERS = [1, 1, 1, 1.6, 1.9, 2.2, 2.5];
const NORMAL_EXP_PER_PLAYER_PCT = [100, 100, 80, 85, 90, 95, 100];

function eligibleCount(damageMap = {}) {
  return Object.values(damageMap).filter((entry) =>
    Number(entry?.damage) > 0 || Number(entry?.assist) > 0).length;
}

function normalExpMultiplier(count) {
  return EXP_MULTIPLIERS[Math.min(6, Math.max(1, Math.floor(Number(count) || 1)))];
}

function normalExpPerPlayerPct(count) {
  return NORMAL_EXP_PER_PLAYER_PCT[Math.min(6, Math.max(1, Math.floor(Number(count) || 1)))];
}

function normalExpPerPlayer(baseExp, count) {
  const base = Math.max(0, Math.round(Number(baseExp) || 0));
  return Math.ceil(base * normalExpPerPlayerPct(count) / 100);
}

function normalMaxHp(state, monster) {
  if (!monster) return 0;
  const base = Math.max(1, Math.round(Number(monster?.calc?.maxHp) || 1)) * encounterCount(state, monster);
  return base;
}

function scaleNormalMonster(state, monster, damageMap) {
  const base = normalMaxHp(state, monster);
  const oldMax = Number(state?.coopHpMonsterSeq) === Number(monster.seq)
    ? Math.max(base, Number(state?.coopMaxHp) || base) : base;
  const oldHp = Math.max(0, Math.min(oldMax, Number(state?.currentHp ?? oldMax) || 0));
  return {
    coopHpMonsterSeq: monster.seq,
    coopMaxHp: base,
    // Retire an old player-count expansion without healing or reviving segments.
    currentHp: oldHp > 0 ? Math.max(1, Math.ceil(oldHp * base / oldMax)) : 0,
  };
}

module.exports = { eligibleCount, normalExpMultiplier, normalExpPerPlayerPct, normalExpPerPlayer, normalMaxHp, scaleNormalMonster };
