"use strict";
// Live item snapshot + actual combat loop + authenticated profile HTTP; isolated MongoDB only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { BSON } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const snapshot = process.argv.find(a => a.startsWith('--snapshot='))?.slice(11);
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
assert.ok(snapshot && output, '--snapshot and --output required');
const bytes = fs.readFileSync(path.join(snapshot, 'items.bson'));
const items = [];
for (let i = 0; i < bytes.length;) { const n = bytes.readInt32LE(i); items.push(BSON.deserialize(bytes.subarray(i, i + n))); i += n; }
const entry = id => { const item = items.find(i => i.id === id); assert.ok(item, id); return { ...item, itemId: id, itemName: item.name, uuid: id }; };
const weapon = entry('hutao-wind-sword-1h');
const shields = ['hutao-wind-offhand-sword', 'hutao-wind-offhand-dagger'].map(entry);
const report = { snapshot, seed: 937451, productionWrites: false, comparisons: 0, checks: [], failures: [], sourceHashes: {} };
const check = async (name, fn) => { try { await fn(); report.checks.push(name); console.log('PASS', name); } catch (e) { report.failures.push({ name, error: e.stack }); console.error('FAIL', name, e.message); } };
(async () => {
 const mongo = await MongoMemoryServer.create();
 process.env.MONGODB_URI = mongo.getUri(); process.env.MONGODB_DB_NAME = 'qa_unique_passive';
 process.env.JWT_SECRET = 'unique-passive-isolated-secret-0123456789';
 const { getMongoDb, closeMongoClient } = require('../src/adapters/mongo/createMongoClient');
 let server;
 try {
  const db = await getMongoDb(); await db.collection('items').insertMany(items);
  const { calcPlayerStats } = require('../src/shared/combatStats');
  const { runCombatLoop } = require('../src/shared/combatLoop');
  const { buildItemEffectLines } = require('../src/shared/itemEffectLines');
  const attrs = { str: 40, agi: 30, vit: 40, int: 10, dex: 30, luk: 20 };
  const monster = { level: 40, maxHp: 99999999, atk: 1, def: 10, flatDef: 0, agi: 1, dex: 1, luk: 0, int: 1, dodge: 0, hit: 1, critRate: 0, comboChance: 0, blockChance: 0 };
  // Keep the same real dual-wield gear/stats in both runs. Only remove the duplicate
  // offhand passive in the baseline, so legitimate offhand stats/attacks still apply.
  for (const shield of shields) {
   const equipped = { weapon, shield };
   const baseline = { weapon, shield: { ...shield, passiveEffects: [] } };
   const stats = calcPlayerStats(attrs, equipped, [], []);
   for (const live of [false, true]) await check(`${shield.itemId}: ${live ? 'live' : 'round'} duplicate equals one passive`, () => {
    for (let phase = 0; phase < 4; phase++) for (let sample = 0; sample < 25; sample++) {
     const run = eq => {
      let seed = 937451 + sample; const random = Math.random;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      try {
       const options = { equipped: structuredClone(eq), inventory: [], windDirectionStep: phase, skipMonsterAttack: true, playerLevel: 50,
        ...(live ? { actionSession: {}, liveNormalCombat: true, startPlayerHp: stats.maxHp, startMonsterHp: monster.maxHp } : {}) };
       return runCombatLoop(structuredClone(stats), monster, '唯一被動驗收', monster.maxHp, 4, options);
      } finally { Math.random = random; }
     };
     const one = run(baseline), two = run(equipped);
     assert.ok(one.totalDamage > 0);
     assert.equal(two.totalDamage, one.totalDamage);
     assert.equal(two.windDirectionStep, one.windDirectionStep);
     assert.deepEqual(two.roundLogs, one.roundLogs);
     report.comparisons++;
    }
   });
  }
  await check('every live Hutao weapon identifies unique passive', () => {
   const weapons = items.filter(i => i.passiveEffects?.some(e => e.key === 'wind_direction_cycle'));
   assert.equal(weapons.length, 13);
   for (const item of weapons) assert.equal(buildItemEffectLines(item).filter(l => l.includes('唯一被動・風向輪轉（不疊加）')).length, 1);
  });
  let equipped = { weapon, shield: shields[0] };
  const regular = { key: 'lifesteal', trigger: 'passive', params: { value: 5 }, notes: '吸血 +5%' };
  const progress = { level: 50, attributes: attrs, inventory: [], activeEffects: [], equipment: equipped };
  const serviceContext = { playerService: { getProfile: async () => ({ player: { discordId: 'qa_unique' }, wallet: { gold: 1 }, progress }) }, progressRepository: { updateFields: async () => {} } };
  const app = require('express')();
  app.use(require('../src/api/routes/playerAppRoutes').createPlayerAppRoutes(serviceContext, null));
  app.use((e, req, res, next) => res.status(500).json({ error: e.message }));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const token = require('jsonwebtoken').sign({ discordId: 'qa_unique' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  for (const [name, eq, count] of [
   ['main only', { weapon }, 1], ['offhand only', { shield: shields[0] }, 1],
   ['main and sword', { weapon, shield: shields[0] }, 1], ['main and dagger', { weapon, shield: shields[1] }, 1],
   ['unequipped', {}, 0], ['unrelated stackable effects preserved', { weapon: { ...weapon, passiveEffects: [...weapon.passiveEffects, regular] }, shield: { ...shields[0], passiveEffects: [...shields[0].passiveEffects, regular] } }, 1],
  ]) await check(`profile HTTP: ${name}`, async () => {
   progress.equipment = eq;
   const r = await fetch(`http://127.0.0.1:${server.address().port}/api/me/profile`, { headers: { Authorization: `Bearer ${token}` } });
   const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body));
   const effects = body.data.progress.bodyEffects;
   assert.equal(effects.filter(e => e.desc.includes('唯一被動・風向輪轉（不疊加）')).length, count);
   if (name.startsWith('unrelated')) assert.equal(effects.filter(e => e.desc === '吸血 +5%').length, 2);
   for (const item of Object.values(body.data.progress.equipment)) assert.ok(item.effectLines.some(l => l.includes('唯一被動')));
  });
 } finally {
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  await closeMongoClient(); await mongo.stop();
  for (const file of ['src/shared/windDirection.js','src/shared/itemEffectLines.js','src/shared/combatLoop.js','src/api/routes/playerAppRoutes.js']) report.sourceHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
 }
 if (report.failures.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
