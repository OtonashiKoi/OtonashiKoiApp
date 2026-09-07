"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const service = require("../src/services/battle/zoneBattleService");
assert.ok(!Object.keys(require.cache).some(path => path.endsWith('/bot/handlers/monsterZoneHandlers.js')));
assert.ok(!fs.readFileSync(require.resolve('../src/api/routes/playerAppRoutes'), 'utf8').includes('require("../../bot/handlers/monsterZoneHandlers")'));
const farmModule = require.resolve('../src/services/farmFatigue/farmFatigueService');
require.cache[farmModule] = { id: farmModule, filename: farmModule, loaded: true, exports: { applyAndGetMultiplier: async () => 1 } };

function fixture() {
  const grants = [], experience = [], notices = [], saved = [];
  let claimed = false;
  const state = { activeMonsterSeq: 1, currentHp: 0, participants: ['p'], damageMap: { p: { name: 'Player', damage: 80 } }, killCount: {} };
  const sc = {
    monsterRepository: { async claimKill() { if (claimed) return false; claimed = true; await new Promise(r => setTimeout(r, 5)); return true; } },
    progressRepository: { findByPlayerId: async () => ({ inventory: [], equipment: {}, level: 1 }) },
    itemRepository: { findById: async () => null },
    rewardService: { grantCurrency: async payload => grants.push(payload) },
    progressService: { grantExp: async payload => { experience.push(payload); return { levelUps: 0, progress: { level: 1 } }; } },
    monsterService: { getState: async () => structuredClone(state), listMonsters: async () => [], saveState: async next => saved.push(next) },
    monsterEventService: { listEvents: async () => [], pickEventForTransition: async () => null },
    worldBossServiceFor: () => null,
    _pushRewardToPlayer: (pid, payload) => notices.push({ pid, payload })
  };
  return { sc, grants, experience, notices, saved, input: { serviceContext: sc, discordId: 'p', displayName: 'Player',
    session: { monsterMaxHp: 100 }, monster: { id: 'm', seq: 1, name: 'Monster', calc: { maxHp: 100 }, goldReward: 100, expReward: 100, drops: [] },
    state, totalDamage: 20, zoneKey: 'normal' } };
}
async function main() {
  const f = fixture();
  const results = await Promise.all([service.handleMonsterKill(f.input), service.handleMonsterKill(f.input)]);
  assert.equal(f.grants.length, 1);
  assert.equal(f.grants[0].amount, 220); // normal-zone one-player minimum pool
  assert.equal(f.experience.length, 1);
  assert.equal(f.experience[0].amount, 100);
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].killCount.m, 1);
  assert.equal(f.notices.length, 1);
  assert.equal(results.find(r => r._summary)._summary.gold, 220);
  await service.handleMonsterKill(f.input);
  assert.equal(f.grants.length, 1, 'DB kill claim must reject a later duplicate');

  const boss = fixture();
  boss.input.zoneKey = 'event_boss'; boss.input.monster.isBoss = true;
  boss.input.state.worldBossPartsHp = { head: 0, body: 5, wings: 0, legs: 0 };
  const partial = await service.handleMonsterKill(boss.input);
  assert.match(partial[0], /所有部位全破/);
  assert.equal(boss.grants.length, 0);

  const failed = fixture();
  failed.sc.monsterRepository.claimKill = async () => { throw Error('DB unavailable'); };
  await assert.rejects(() => service.handleMonsterKill(failed.input), /DB unavailable/);
  assert.equal(service.killInProgress.size, 0, 'failure must release process-local claim');
  const handler = require('../src/bot/handlers/monsterZoneHandlers');
  assert.equal(handler.handleMonsterKill, service.handleMonsterKill, 'both adapters use the same settlement implementation');
  assert.equal(handler.getWorldBossPartKeys, service.getWorldBossPartKeys);
  console.log('PASS: headless shared settlement, normal reward/EXP/transition/notification, simultaneous and later duplicate kills, boss partial kill, failure cleanup, Discord compatibility');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
