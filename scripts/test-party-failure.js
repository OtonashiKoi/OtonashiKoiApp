"use strict";
const assert = require("node:assert/strict");
require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => { throw Error("isolated party failure test: live DB forbidden"); };
const { analyzePartyFailure } = require("../src/services/tower/partyTowerFailure");
const { fixture, setup } = require("./test-party-tower-v2");
async function main() {
  const members = [{ discordId: "t", name: "坦", towerRole: "tank" }, { discordId: "d", name: "輸出", towerRole: "dps" }, { discordId: "old", name: "前樓倒地" }];
  const room = { members, liveCombat: { initialMembers: [{ discordId: "t", currentHp: 100 }, { discordId: "d", currentHp: 100 }, { discordId: "old", currentHp: 0 }] } };
  const hp = (t, d) => ({ partyHpAfter: [{ discordId: "t", hp: t }, { discordId: "d", hp: d }, { discordId: "old", hp: 0 }] });
  const result = { monsterHpFinal: 400, memberLogs: [hp(0, 100), hp(0, 100), hp(30, 100), hp(0, 0)], summary: { damageTaken: [{ name: "坦", value: 130 }, { name: "輸出", value: 100 }], healing: [{ name: "坦", value: 30 }] } };
  const a = analyzePartyFailure(room, result, 1000);
  assert.deepEqual(a.evidence.deathChain.map(d => [d.discordId, d.action]), [["t", 1], ["t", 4], ["d", 4]]);
  assert.match(a.reason, /40%/); assert.match(a.reason, /承傷 230／治療 30/);
  assert(!a.reason.includes("前樓倒地"));
  assert(!analyzePartyFailure({ members }, { monsterHpFinal: 500 }, 0).reason.includes("治療"));
  console.log("PASS evidence: deaths, revival, simultaneous deaths, no previous-floor death, no invented missing stats");
  const f = fixture(); delete f.opts.fightFloor; delete f.opts.playbackMs;
  f.sc.monsterService.listMonsters = async () => [{ id: "fatal", name: "重擊測試怪", zone: "ancient_city", level: 20,
    expReward: 100, goldReward: 100, calc: { maxHp: 1e9, atk: 1e8, agi: 200, dex: 200, hit: 100, dodge: 0, def: 0, flatDef: 0, dmgMin: 1, dmgMax: 1, crit: 0 } }];
  const s = await setup(f); await s.startRoom("party-test-1");
  for (let i = 0; i < 30; i++) { f.advance(2000); await s.tick(); if ((await s.getState("party-test-1")).status === "ended") break; }
  const ended = await s.getState("party-test-1");
  assert.equal(ended.status, "ended"); assert.equal(ended.clearedFloor, 0);
  assert.equal(ended.lastFloorResult.failureAnalysis.deathChain.length, 2);
  assert.match(ended.failReason, /承傷/); assert.match(ended.failReason, /倒地順序/);
  assert.equal(ended.reward.gold, 0); assert.equal(ended.reward.exp, 0);
  assert.deepEqual(ended.reward.drops, []); s.close();
  console.log("PASS real incremental room: all-dead stops, factual failure explanation, zero-floor no rewards");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
