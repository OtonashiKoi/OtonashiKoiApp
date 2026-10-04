"use strict";
const assert = require("assert/strict");
const { WorldBossService, WORLD_BOSS_ZONES } = require("../src/services/worldBoss/worldBossService");
const { PREREQUISITES, recordClears } = require("../src/services/worldBoss/worldBossProgression");
const { canPlayerAccessZone } = require("../src/shared/zones");
(async () => {
  const players = { a: {}, b: {} };
  const progressRepository = {
    findByPlayerId: async id => players[id],
    updateFields: async (id, fields) => {
      players[id].accountWorldBossClears ||= {};
      for (const key of Object.keys(fields)) players[id].accountWorldBossClears[key.split('.')[1]] = fields[key];
      return true;
    },
  };
  const repo = { getConfig: async () => ({ enabled: true }), getState: async () => null, saveState: async () => {} };
  for (const [key, prereq] of Object.entries(PREREQUISITES).filter(([, prerequisite]) => prerequisite)) {
    const svc = new WorldBossService(repo, { bossKey: key, progressRepository });
    assert.equal((await svc.getConfigWithStatus('a')).status.canChallenge, false, key);
    const zone = Object.keys(WORLD_BOSS_ZONES).find(z => WORLD_BOSS_ZONES[z] === prereq);
    await recordClears(progressRepository, zone, ['a', 'a']);
    assert.equal((await svc.getConfigWithStatus('a')).status.canChallenge, true, key);
    assert.equal((await svc.getConfigWithStatus('b')).status.canChallenge, false, 'another player cannot unlock');
    delete players.a.accountWorldBossClears;
  }
  const brokenRepo = { findByPlayerId: async () => { throw Error('db down'); } };
  await assert.rejects(new WorldBossService(repo, { bossKey: 'dragon_king', progressRepository: brokenRepo }).getConfigWithStatus('a'));
  assert.equal((await new WorldBossService(repo, { bossKey: 'default', progressRepository }).getConfigWithStatus('b')).status.canChallenge, true);
  for (const zone of ['event_boss', 'event_boss_hutao_preview', 'event_boss_rabbit_preview']) {
    assert.equal(canPlayerAccessZone(zone, 'ordinary-player'), false);
    assert.equal(canPlayerAccessZone(zone, '865264891991425055'), false);
  }
  console.log('PASS: personal prerequisites, account isolation, DB failure, first boss, three private event bosses');
})().catch(e => { console.error(e); process.exitCode = 1; });
