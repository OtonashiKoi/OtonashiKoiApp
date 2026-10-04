"use strict";
const { createGameProgress } = require('../../src/domain/progress/createGameProgress');
const { mergeEquippedFromLibrary } = require('../../src/shared/effectEngine');
const { calcPlayerStats } = require('../../src/shared/combatStats');
const { runCombatLoop } = require('../../src/shared/combatLoop');
async function starterPlayer(items, level = 1) {
  const p = createGameProgress('simulation-only');
  p.level = level;
  const points = level - 1;
  for (const key of Object.keys(p.attributes)) p.attributes[key] += points / 6;
  p.attributes.str += points * .55;
  p.attributes.vit += points * .3;
  p.attributes.agi += points * .15;
  const equipped = await mergeEquippedFromLibrary(p.equipment, { findById: async id => items.find(i => i.id === id) });
  return { attrs: p.attributes, equipped };
}
async function simulateStarter(m, items, level = 1, runs = 200, seedValue = 20260930) {
  const p = await starterPlayer(items, level);
  const stats = calcPlayerStats(p.attrs, p.equipped, [], [], { zone: 'beginner' });
  let seed = seedValue, deaths = 0, kills = 0, rounds = 0, first = 0;
  const original = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    for (let i = 0; i < runs; i++) {
      const r = runCombatLoop(structuredClone(stats), { ...m.calc }, m.name, m.calc.maxHp, 15, {
        playerLevel: level, equipped: p.equipped, inventory: [], monsterEquipped: {}, zone: 'beginner', monsterIsBoss: false,
      });
      deaths += r.outcome === 'lose'; kills += r.outcome === 'win';
      first += r.outcome === 'win' && r.nextRound === 1;
      rounds += Math.min(15, r.outcome === 'timeout' ? r.nextRound - 1 : r.nextRound);
    }
  } finally { Math.random = original; }
  const result = { deathPct: 100 * deaths / runs, killPct: 100 * kills / runs, rounds: rounds / runs, firstRoundPct: 100 * first / runs };
  return { ...result, atk: stats.atk, byJob: { starterWoodenSword: result } };
}
module.exports = { starterPlayer, simulateStarter };
