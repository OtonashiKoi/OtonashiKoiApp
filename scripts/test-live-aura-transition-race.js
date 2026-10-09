"use strict";
require("dotenv").config({ quiet: true });
process.env.MONGODB_DB_NAME = `qa_aura_transition_${Date.now()}`;
const assert = require("node:assert/strict");
const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { handoff, settle } = require("../src/services/realtime/normalLiveSettlement");
const presentation = require("../src/services/battle/battlePresentation");
presentation._republishPanel = async () => {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const db = await getMongoDb(), sc = createServiceContext(), zone = "ancient_city_deep";
  assert.ok(db.databaseName.startsWith("qa_aura_transition_"));
  const monster = { id: "qa-wizard", name: "驗收巫師", seq: 12, zone, enabled: true, calc: { maxHp: 100 }, isBoss: false };
  const successor = { ...monster, id: "qa-next", name: "驗收下一隻", seq: 20 };
  sc.monsterService.listMonsters = async () => [monster, successor];
  sc.monsterEventService.pickEventForTransition = async () => null;
  const dead = { activeMonsterSeq: 12, currentHp: 0, killCount: {}, encounterMonsterSeq: 12, encounterCount: 3,
    normalLiveSpawnAt: 123, activeTransition: null, activeEvent: null, activeHealerAuras: [], activeHealerAura: null,
    normalLive: { encounterKey: `${zone}:12:0`, actors: {}, killReceipt: true }, damageMap: { qa: { damage: 100 } } };
  const write = async value => {
    await db.collection("monsters").updateOne({ _id: `monsterState:${zone}` }, { $set: { value } }, { upsert: true });
    await db.collection("monsterState").updateOne({ _id: zone }, { $set: { value } }, { upsert: true });
  };
  const stale = { ...dead, currentHp: 100 };
  const transition = { ...dead, killCount: { [monster.id]: 3 }, activeTransition: { id: "already-transitioned" } };
  await write(transition);
  // Reproduce the old caller's whole-state save undoing an already committed handoff.
  await sc.monsterService.saveState({ ...dead, activeHealerAuras: [{ discordId: "qa" }] }, zone);
  assert.equal((await sc.monsterService.getState(zone)).activeTransition, null);
  assert.deepEqual((await sc.monsterService.getState(zone)).killCount, {});
  await write(transition);
  assert.equal(await sc.monsterService.saveBattleAuras(dead, [{ discordId: "qa" }], zone), false);
  assert.deepEqual(await sc.monsterService.getState(zone), transition);
  const live = { ...stale, currentHp: 40, participants: ["new-player"], normalLive: { ...stale.normalLive, actors: { new: { active: true } } } };
  await write(live);
  assert.equal(await sc.monsterService.saveBattleAuras(stale, [{ discordId: "qa" }], zone), true);
  assert.deepEqual(await sc.monsterService.getState(zone), { ...live, activeHealerAuras: [{ discordId: "qa" }] });
  assert.equal(await sc.monsterService.saveBattleAuras(stale, [], zone), false, "concurrent aura update cannot be lost");
  await write({ ...stale, normalLiveSpawnAt: 456 });
  assert.equal(await sc.monsterService.saveBattleAuras(stale, [], zone), false, "same-seq successor rejects old admission");
  await write(dead);
  const job = await sc.liveSettlementRepository.create({ key: dead.normalLive.encounterKey, zone, state: dead, monster });
  await sc.liveSettlementRepository.handoff(job.key);
  await sc.liveSettlementRepository.complete(job.key, {});
  const completed = await sc.liveSettlementRepository.find(job.key);
  await handoff(sc, completed);
  const repaired = await sc.monsterService.getState(zone);
  assert.ok(repaired.activeTransition);
  assert.equal(repaired.killCount[monster.id], 3);
  await handoff(sc, completed);
  assert.deepEqual(await sc.monsterService.getState(zone), repaired, "repeated recovery cannot double count");
  await wait(Math.max(0, Date.parse(repaired.activeTransition.endsAt) - Date.now()) + 100);
  const next = await sc.monsterService.getState(zone);
  assert.equal(next.activeMonsterSeq, successor.seq);
  assert.ok(next.currentHp > 0);
  await handoff(sc, completed);
  assert.deepEqual(await sc.monsterService.getState(zone), next);
  assert.deepEqual(await settle({}, completed), [], "completed job performs no currency, EXP or inventory write");
  console.log(JSON.stringify({ ok: true, testDb: db.databaseName, checks: 10, oldRaceReproduced: true, nextMonsterSeq: next.activeMonsterSeq }));
  await closeMongoClient();
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => closeMongoClient());
