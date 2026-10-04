"use strict";
// Read-only acceptance run. Report all failures before exiting; never tune to the held-out seed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadBson } = require('./verify-normal-progression');
const { simulate } = require('./verify-normal-basic-combat');
const { simulateStarter } = require('./lib/beginner-combat');
const { MonsterService } = require('../src/services/monster/monsterService');
const { SETTINGS } = require('./lib/gear-ladder');
const SEED = 937451, RUNS = 200;
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function main() {
  const arg = key => process.argv.find(a => a.startsWith(key + '='))?.slice(key.length + 1);
  const dir = arg('--snapshot');
  if (!dir) throw Error('--snapshot is required');
  const items = loadBson(path.join(dir, 'items.bson'));
  const source = loadBson(path.join(dir, 'monsters.bson'));
  const planFile = arg('--plan');
  const changes = planFile ? new Map(JSON.parse(fs.readFileSync(planFile)).plan.map(x => [x.id, x.values])) : null;
  const all = await new MonsterService({ findAll: async () => source.map(m => ({ ...m, ...changes?.get(m.id) })) }).listMonsters();
  const selected = all.filter(m => m.enabled && SETTINGS[m.zone] && !m.isBoss && !m.allZones && !m.incomingDamageCap && (!changes || changes.has(m.id)));
  if (!selected.length) throw Error('No ordinary monsters selected');
  const failures = [], rows = [], summary = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  for (const m of selected) {
    const t = SETTINGS[m.zone], tier = t.tiers[2];
    const prev = m.zone === 'normal' ? 'none' : t.tiers[1];
    const fullTier = m.zone === 'beginner' ? 'none' : tier;
    const r = { id: m.id, name: m.name, zone: m.zone, atk: m.calc.atk, hp: m.calc.maxHp, exp: m.expReward };
    const cases = {
      full: [t.level, fullTier, fullTier],
      armorLow: [t.level, prev, tier],
      weaponLow: [t.level, tier, prev],
      insufficient: [t.level, t.tiers[0], t.tiers[0]],
      midpoint: [m.zone === 'normal' ? 7 : t.level + 4, fullTier, fullTier],
    };
    for (const [key, [level, armor, weapon]] of Object.entries(cases)) r[key] = m.zone === 'beginner' && ['full', 'midpoint'].includes(key)
      ? await simulateStarter(m, items, key === 'full' ? 1 : 3, RUNS, SEED)
      : simulate(m, items, level, armor, weapon, RUNS, SEED);
    if (m.zone === 'beginner') {
      check(r.full.firstRoundPct <= 5, `${m.name}: starter first-round kill >5%`);
      check(r.full.rounds >= 3 && r.full.rounds <= 8, `${m.name}: starter rounds outside 3..8`);
      check(r.full.killPct >= 95 && r.full.deathPct <= 5, `${m.name}: starter survival/kill gate failed`);
    }
    if (m.zone !== 'beginner') for (const [job, j] of Object.entries(r.full.byJob)) {
      check(j.deathPct <= 20, `${m.name}/${job}: full gear death ${j.deathPct}% >20%`);
      check(j.killPct >= 80, `${m.name}/${job}: full gear kill ${j.killPct}% <80%`);
      check(j.rounds <= 12, `${m.name}/${job}: full gear rounds ${j.rounds} >12`);
    }
    rows.push(r);
  }
  for (const zone of Object.keys(SETTINGS)) {
    const rs = rows.filter(r => r.zone === zone);
    if (!rs.length) { if (!changes) check(false, `${zone}: no ordinary monsters tested`); continue; }
    const means = { zone, count: rs.length, atkRange: [Math.min(...rs.map(r => r.atk)), Math.max(...rs.map(r => r.atk))], hpRange: [Math.min(...rs.map(r => r.hp)), Math.max(...rs.map(r => r.hp))] };
    const raw = {};
    for (const key of ['full', 'armorLow', 'weaponLow', 'insufficient', 'midpoint']) {
      raw[key] = Object.fromEntries(['deathPct', 'killPct', 'rounds'].map(k => [k, rs.reduce((s, r) => s + r[key][k], 0) / rs.length]));
      means[key] = Object.fromEntries(Object.entries(raw[key]).map(([k, v]) => [k, +v.toFixed(1)]));
    }
    if (zone !== 'beginner') {
      check(raw.full.deathPct <= 10, `${zone}: full gear average death ${raw.full.deathPct}% >10%`);
      check(raw.insufficient.deathPct >= 50, `${zone}: insufficient gear death ${raw.insufficient.deathPct}% <50%`);
      check(raw.armorLow.deathPct > raw.full.deathPct + 10, `${zone}: armor improvement <=10 percentage points`);
      check(raw.weaponLow.rounds > raw.full.rounds * 1.1, `${zone}: weapon improvement <=10% rounds`);
    }
    summary.push(means); console.log(JSON.stringify(means));
  }
  const files = ['src/shared/combatLoop.js', 'src/shared/combatStats.js', 'src/shared/battleTiming.js', 'src/shared/weaponBaseAttack.js', 'scripts/verify-normal-basic-combat.js', 'scripts/check-normal-basic-gradient.js', 'scripts/lib/gear-ladder.js'];
  const hashes = Object.fromEntries(files.map(f => [f, digest(path.join(__dirname, '..', f))]));
  const report = { generatedAt: new Date().toISOString(), sourceMode: planFile ? 'snapshot plus explicit plan' : 'snapshot only', seed: SEED, runsPerJob: RUNS, battles: rows.reduce((sum, row) => sum + (row.zone === 'beginner' ? 11 : 15) * RUNS, 0), snapshots: { monsters: digest(path.join(dir, 'monsters.bson')), items: digest(path.join(dir, 'items.bson')) }, hashes, passed: !failures.length, failures, summary, rows };
  const output = arg('--output') || path.join(dir, 'basic-heldout.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`${report.passed ? 'PASS' : 'FAIL'}: ${report.battles} battles; ${failures.length} failures; report ${output}`);
  if (failures.length) { for (const message of failures) console.error(message); process.exitCode = 1; }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
