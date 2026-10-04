"use strict";
const assert = require("assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
(async () => {
  const server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB_NAME = 'worldboss_clear_test';
  const { getMongoDb, closeMongoClient } = require('../src/adapters/mongo/createMongoClient');
  try {
    const db = await getMongoDb();
    await require('../src/services/access/seasonStateStore').ensureLoaded();
    const p = require('../src/domain/progress/createGameProgress').createGameProgress('test-clear');
    await db.collection('progress').insertOne({ ...p, seasonKey: 'legacy', accountWorldBossClears: { default: true } });
    const repo = require('../src/adapters/mongo/createMongoRepositories').createMongoRepositories().progressRepository;
    const stale = await repo.findByPlayerId('test-clear');
    await require('../src/services/worldBoss/worldBossProgression').recordClears(repo, 'dragon_king_lair', ['test-clear']);
    stale.level = 2;
    await repo.save(stale);
    const fresh = await repo.findByPlayerId('test-clear');
    assert.equal(fresh.accountWorldBossClears.default, true);
    assert.equal(fresh.accountWorldBossClears.dragon_king, true, 'stale save preserves concurrent clear');
    const policy = require('../src/services/admin/seasonResetPolicy');
    assert.ok(policy.RESET_UNSET_FIELDS.includes('accountWorldBossClears'));
    console.log('PASS: atomic clears survive stale progress saves; season reset includes clears');
  } finally { await closeMongoClient(); await server.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
