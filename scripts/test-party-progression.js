"use strict";
const assert = require('node:assert/strict');
const { fixture, setup } = require('./test-party-tower-v2');
const { WeeklyQuestService, QUEST_CADENCES, resolvePeriodKey } = require('../src/services/weeklyQuest/weeklyQuestService');
const { killRecord, settleProgress } = require('../src/services/tower/partyTowerProgress');
const { buildProgressResetUpdate } = require('../src/services/admin/seasonResetPolicy');
async function main() {
  const f = fixture(), rows = new Map(); let fail = false;
  const qs = new WeeklyQuestService({
    getPlayerProgress: async (id, period, cadence) => structuredClone(rows.get(`${id}:${cadence}:${period}`) || {}),
    savePlayerProgress: async (id, period, progress, cadence) => { rows.set(`${id}:${cadence}:${period}`, structuredClone(progress)); if (fail) { fail = false; throw Error('write succeeded but response lost'); } },
  }, {});
  qs._getPlayerQuestContext = async () => ({});
  qs.listDefinitions = async () => [
    { id: 'wins', cadence: 'daily', enabled: true, type: 'battle_win', target: 100 },
    { id: 'damage', cadence: 'weekly', enabled: true, type: 'damage_total', target: 100000 },
    { id: 'disabled', cadence: 'daily', enabled: false, type: 'battle_win', target: 100 },
  ];
  qs._canAccrueProgress = () => true;
  f.sc.questService = qs;
  const p = f.players.get('party-test-1');
  p.equipment.job_eq = { itemId: 'badge', uuid: 'badge-instance', itemType: 'job_badge', jobExp: 0 };
  const member = { discordId: p.playerId, stats: { weaponType: 'sword_1h' }, equipped: structuredClone(p.equipment), progressSnapshot: structuredClone(p) };
  const room = { runId: 'retry-test', clearedFloor: 1, difficulty: 'normal', monsterPreview: { hp: 100 } };
  const record = killRecord(room, member, { id: 'm' }, { memberDamage: [{ discordId: p.playerId, damageDealt: 25 }] }, Date.now());
  assert.equal(record.gain, .25); assert.equal(record.metrics.battle_with_sword, 1);
  const r = { progressKills: [record] };
  fail = true;
  await assert.rejects(settleProgress(f.sc, room, member, r, Date.now()), /response lost/);
  await settleProgress(f.sc, room, member, r, Date.now());
  await settleProgress(f.sc, room, member, r, Date.now());
  const after = f.players.get(p.playerId);
  assert.equal(after.bestiary.m, .25); assert.equal(after.equipment.job_eq.jobExp, 1);
  assert.equal(rows.get(`${p.playerId}:daily:${record.periodKeys.daily}`).wins.current, 1);
  assert.equal(rows.get(`${p.playerId}:weekly:${record.periodKeys.weekly}`).damage.current, 25);
  assert.equal(rows.get(`${p.playerId}:daily:${record.periodKeys.daily}`).disabled, undefined);
  // Retry uses the period captured at the kill, not the current calendar period.
  record.periodKeys = Object.fromEntries(QUEST_CADENCES.map(c => [c, `past-${resolvePeriodKey(c)}`]));
  await settleProgress(f.sc, { ...room, runId: 'past-period' }, member, r, Date.now());
  assert.equal(rows.get(`${p.playerId}:daily:${record.periodKeys.daily}`).wins.current, 1);
  f.players.get(p.playerId).activeCharacterSlot = 2;
  await assert.rejects(settleProgress(f.sc, { ...room, runId: 'switched' }, member, r, Date.now()), /人物已切換/);
  const pendingTitle = { uuid: 'title', itemType: 'title', itemId: 'title' };
  const reset = buildProgressResetUpdate({ playerId: 'reset', inventory: [pendingTitle], partyPendingDrops: [pendingTitle, { uuid: 'weapon', itemType: 'equipment' }, { uuid: 'collect', itemType: 'collection' }] });
  assert.deepEqual(reset.$set.inventory.map(e => e.uuid), ['title', 'collect']);
  for (const key of ['partyPendingDrops','partyItemReceipts','partyPotionReceipts','partyJobStateReceipt','partyProgressReceipts']) assert.equal(reset.$unset[key], '');
  const end = fixture(); end.sc.questService = qs;
  const s = await setup(end); await s.startRoom('party-test-1');
  for (let i = 0; i < 12000; i++) { end.advance(); await s.tick(); if ((await s.getState('party-test-1'))?.settled) break; }
  const view = await s.getState('party-test-1'); assert.equal(view.settled, true); assert.equal([...end.rooms.values()][0].rewards["party-test-1"].progressKills.length, 30); assert.equal(view.reward.progressKills, undefined);
  const counts = end.players.get('party-test-1').bestiary;
  assert.ok(Object.values(counts).reduce((a,b)=>a+b,0) > 0);
  const before = structuredClone(counts); await s.tick(); assert.deepEqual(end.players.get('party-test-1').bestiary, before);
  s.close(); require('../src/shared/battlePresence').setTowerPresence(['party-test-1','party-test-2'], false);
  console.log('PASS persisted 30-floor progression, fractional bestiary, badge proficiency, quest lost-response retry, captured periods, character guard, reset retention');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
