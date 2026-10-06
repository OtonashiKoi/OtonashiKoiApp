"use strict";
const assert = require("node:assert/strict");
const { startRoomClock } = require("../src/services/realtime/starterCompanionRooms");
const { NormalLiveCombat } = require("../src/services/realtime/normalLiveCombat");
const { ZoneCombatScene } = require("../src/services/realtime/zoneCombatScene");
async function main() {
  const original = global.setInterval;
  let tick, release, runs = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const room = { zone: "normal", closed: false };
  const engine = new NormalLiveCombat({ auto: true, starterNpcs: false, scene: new ZoneCombatScene({ emit: () => {} }) });
  engine.advance = zone => engine.serial(zone, async () => { runs++; await blocked; });
  global.setInterval = (callback, interval) => { assert.equal(interval, 40); tick = callback; return { unref() {} }; };
  try {
    startRoomClock(engine, room);
    for (let i = 0; i < 25; i++) tick();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(runs, 1, "a slow database cannot enqueue twenty-five clock jobs");
    let joined = false;
    const join = engine.serial("normal", async () => { joined = true; });
    release(); await join; await new Promise(resolve => setImmediate(resolve));
    assert.equal(joined, true); assert.equal(runs, 1); assert.equal(room.clockPending, false);
    tick(); await engine.queues.get("normal"); await new Promise(resolve => setImmediate(resolve));
    assert.equal(runs, 2, "clock resumes after the pending work completes");
    room.closed = true; tick(); assert.equal(runs, 2);
  } finally { global.setInterval = original; }

  let now = 1000, reads = 0;
  const scene = new ZoneCombatScene({ now: () => now, emit: () => {} });
  const live = new NormalLiveCombat({ now: () => now, scene, auto: false, starterNpcs: false });
  const actor = { actorId: "clock-test", actorName: "測試", hp: 100, maxHp: 100, attackAt: 1500, done: false, stats: { weaponType: "sword_1h" } };
  const active = { zone: "normal", seq: 1, closed: false, enemyAt: 2000, npcWakeAt: 1800, members: new Map([[actor.actorId, actor]]), companions: [],
    monster: { id: "qa", seq: 1, name: "驗收怪", maxHp: 1000, agi: 1 }, sc: { monsterService: { getState: async () => { reads++; return { activeMonsterSeq: 1, currentHp: 1000, normalLive: { npcs: {} } }; } } } };
  live.zones.set("normal", active);
  for (now = 1000; now < 1380; now += 40) await live.advance("normal");
  assert.equal(reads, 0, "waiting for windup/attack has no database reads");
  now = 1380; await live.advance("normal");
  assert.equal(reads, 1); assert.equal(actor.announcedAt, 1500, "windup retains the original 120ms lead");
  now = 1420; await live.advance("normal"); assert.equal(reads, 1);
  console.log(JSON.stringify({ passed: true, busyClockTicks: 25, queuedClockJobs: 1, waitingDatabaseReads: 0, windupLeadMs: 120, joinNotStarved: true, resumedClock: true, closedClockStops: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
