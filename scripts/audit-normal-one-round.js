"use strict";
const fs = require('fs'), crypto = require('crypto');
const { loadBson, buildPlayer } = require('./verify-normal-progression');
const { basicPlayer } = require('./verify-normal-basic-combat');
const { SETTINGS } = require('./lib/gear-ladder');
const { simulateStarter } = require('./lib/beginner-combat');
const { MonsterService } = require('../src/services/monster/monsterService');
const { calcPlayerStats } = require('../src/shared/combatStats');
const { runCombatLoop } = require('../src/shared/combatLoop');
const { buildBattleOptions } = require('./lib/jobBattleOptions');
const { mergeEquippedFromLibrary } = require('../src/shared/effectEngine');
async function main() {
  const arg = k => process.argv.find(a => a.startsWith(k + '='))?.slice(k.length + 1);
  const dir = arg('--snapshot'), output = arg('--output');
  if (!dir || !output) throw Error('snapshot and output required');
  const items = loadBson(dir + '/items.bson'), source = loadBson(dir + '/monsters.bson');
  const plan = arg('--plan') ? JSON.parse(fs.readFileSync(arg('--plan'))).plan : [];
  const changes = new Map(plan.map(r => [r.id, r.values]));
  const all = await new MonsterService({ findAll: async () => source.map(m => ({ ...m, ...changes.get(m.id) })) }).listMonsters();
  const rows = [], failures = [], runs = 200, seedValue = Number(arg('--seed') || 937451);
  for (const m of all.filter(m => m.enabled && !m.isBoss && !m.allZones && SETTINGS[m.zone])) {
    const t = SETTINGS[m.zone], row = { id: m.id, name: m.name, zone: m.zone, hp: m.calc.maxHp, cases: [] };
    if (m.zone === 'beginner') {
      for (const level of [1, 2, 3]) row.cases.push({ job: 'starter', level, ...await simulateStarter(m, items, level, runs, seedValue) });
    } else for (const level of [t.level, m.zone === 'normal' ? 7 : t.level + 4]) {
      for (const job of ['swordsman', 'mage', 'archer']) for (const mode of ['basic0', 'skills0', 'skills3']) {
        let p = mode === 'basic0' ? basicPlayer(items, level, t.tiers[2], t.tiers[2], job) : buildPlayer(items, level, t.tiers[2], job);
        if (mode === 'skills3') {
          for (const item of Object.values(p.equipped)) if (item.itemType === 'equipment' && item.equipSlot !== 'job_eq') item.enhanceLevel = 3;
          p.equipped = await mergeEquippedFromLibrary(p.equipped, { findById: async id => items.find(i => i.id === id) });
        }
        const stats = calcPlayerStats(p.attrs, p.equipped, [], [], { zone: m.zone });
        let seed = seedValue, first = 0, win = 0, deaths = 0, rounds = 0;
        const random = Math.random;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        try { for (let i = 0; i < runs; i++) {
          const opts = mode === 'basic0' ? {} : buildBattleOptions({ equipped: p.equipped, pStats: stats, inventory: [] });
          const r = runCombatLoop(structuredClone(stats), { ...m.calc }, m.name, m.calc.maxHp, 15, {
            ...opts, playerLevel: level, equipped: p.equipped, inventory: [], monsterEquipped: mode === 'basic0' ? {} : m.equipment || {}, zone: m.zone, monsterIsBoss: false,
          });
          first += r.outcome === 'win' && r.nextRound === 1; win += r.outcome === 'win'; deaths += r.outcome === 'lose';
          rounds += Math.min(15, r.outcome === 'timeout' ? r.nextRound - 1 : r.nextRound);
        }} finally { Math.random = random; }
        row.cases.push({ job, mode, level, atk: stats.atk, firstRoundPct: first / 2, killPct: win / 2, deathPct: deaths / 2, rounds: rounds / runs });
      }
    }
    if (m.zone === 'beginner' && changes.has(m.id)) {
      const c = row.cases[0];
      if (c.firstRoundPct > 5 || c.rounds < 3 || c.rounds > 8 || c.killPct < 95 || c.deathPct > 5) failures.push({ name: m.name, case: c });
    }
    rows.push(row);
  }
  const summary = Object.keys(SETTINGS).map(zone => {
    const ms = rows.filter(r => r.zone === zone), cs = ms.flatMap(r => r.cases);
    return { zone, monsters: ms.length, maxFirstRoundPct: Math.max(...cs.map(c => c.firstRoundPct)), flagged: ms.filter(m => m.cases.some(c => c.firstRoundPct >= 50)).map(m => ({ name: m.name, hp: m.hp, scenarios: m.cases.filter(c => c.firstRoundPct >= 50) })) };
  });
  const files = ['src/shared/combatLoop.js','src/shared/combatStats.js','scripts/audit-normal-one-round.js','scripts/lib/beginner-combat.js'];
  const report = { seed: seedValue, runs: 200, sourceMode: plan.length ? 'snapshot+plan' : 'snapshot', sourceHashes: Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])), battles: rows.reduce((n, r) => n + r.cases.length * runs, 0), failures, summary, rows };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  for (const s of summary) console.log(JSON.stringify(s));
  if (failures.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
