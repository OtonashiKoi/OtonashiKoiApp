"use strict";

// One species per scene; each segment is one original monster, not a stronger template.
const NORMAL_ZONES = new Set(['beginner', 'normal', 'mid', 'ancient_city', 'mistwood', 'ancient_city_deep', 'dragon_realm', 'hellfire', 'metal_mine']);
const LIVE_ZONES = new Set([...NORMAL_ZONES, 'event_boss_hutao_preview']);
function count(value, max = 5) { return Math.min(max, Math.max(1, Math.floor(Number(value) || 1))); }
function randomCount(max = 3, random = Math.random) { return 1 + Math.min(max - 1, Math.max(0, Math.floor(random() * max))); }
function encounterCount(state, monster) {
  if (monster?.isBoss || !NORMAL_ZONES.has(monster?.zone)) return 1;
  return Number(state?.encounterMonsterSeq) === Number(monster?.seq) ? count(state?.encounterCount, 3) : 1;
}
function expBonusPct(state, monster) { return (encounterCount(state, monster) - 1) * 10; }
function remaining(hp, unitHp, total = 5) { return Math.min(count(total), Math.max(0, Math.ceil(Math.max(0, Number(hp) || 0) / Math.max(1, Number(unitHp) || 1)))); }
function targetHp(hp, unitHp) { return Math.max(0, Number(hp) || 0) - Math.max(0, remaining(hp, unitHp) - 1) * Math.max(1, Number(unitHp) || 1); }
function spawnState(state, monster, random = Math.random) {
  const ordinary = !monster?.isBoss && NORMAL_ZONES.has(monster?.zone);
  const n = ordinary ? randomCount(3, random) : 1;
  const maxHp = Math.max(1, Number(monster.calc.maxHp)) * n;
  return { ...state, encounterCount: n, encounterMonsterSeq: monster.seq, currentHp: maxHp, coopMaxHp: maxHp, coopHpMonsterSeq: monster.seq };
}
module.exports = { NORMAL_ZONES, LIVE_ZONES, count, randomCount, encounterCount, expBonusPct, remaining, targetHp, spawnState };
