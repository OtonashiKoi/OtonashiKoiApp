"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const rules = require("../src/shared/partyTowerRules");
const { createPartyTowerRooms } = require("../src/services/tower/partyTowerRoomsV2");
const { createGameProgress } = require("../src/domain/progress/createGameProgress");
const { ProgressService } = require("../src/services/progress/progressService");
const { fightFloor } = require("../src/bot/handlers/towerHandlers");
const clone = structuredClone;
const checks = [];
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: e.stack }); } finally { require("../src/shared/battlePresence").setTowerPresence(Array.from({ length: 7 }, (_, i) => `party-test-${i + 1}`), false); } }
function fixture() {
  const rooms = new Map(), players = new Map(), gold = new Map(), receipts = new Set();
  for (let i = 1; i <= 7; i++) {
    const p = createGameProgress(`party-test-${i}`); p.level = 40;
    p.attributes = { str: 500, agi: 40, vit: 500, int: 100, dex: 100, luk: 0 }; p.updatedAt = "initial";
    players.set(p.playerId, p);
  }
  const progressRepository = {
    findByPlayerId: async id => clone(players.get(id)),
    saveIfUnchanged: async (p, old) => { if (players.get(p.playerId)?.updatedAt !== old) return false; players.set(p.playerId, clone(p)); return true; },
  };
  const sc = {
    progressRepository, itemRepository: { findById: async id => ({ id, name: "測試區域装", itemType: "equipment", equipSlot: "armor", equipStats: { vit: 1 }, tier: "B" }) },
    rewardService: { grantCurrency: async q => { if (!receipts.has(q.sourceRef)) { gold.set(q.discordId, (gold.get(q.discordId) || 0) + q.amount); receipts.add(q.sourceRef); } } },
    monsterService: { listMonsters: async () => ["ancient_city", "mistwood", "ancient_city_deep", "dragon_realm", "hellfire", "metal_mine"].flatMap(zone => Array.from({ length: 31 }, (_, i) => i + 20).flatMap(level => [false, true].map(isBoss => ({ id: `monster-${zone}-${level}-${isBoss}`, name: isBoss ? "測試王" : "測試怪", zone, level,
      isBoss, maxHp: 20, goldReward: 100, expReward: 100, drops: [{ itemId: "test-item", chance: 100 }],
      calc: { maxHp: 20, atk: 1, level: 30, def: 0, flatDef: 0, dodge: 0, hit: 100, crit: 0, agi: 1, dex: 1, dmgMin: 1, dmgMax: 1 } })))) },
    partyTowerRepository: {
      find: async id => clone(rooms.get(id)), findForPlayer: async id => clone([...rooms.values()].find(r => r.active && r.members.some(m => m.discordId === id))),
      list: async () => clone([...rooms.values()].filter(r => r.active)),
      save: async (r, old) => { if (old != null && rooms.get(r._id)?.version !== old) throw Object.assign(new Error("CAS"), { status: 409 }); r.version = (old || 0) + 1; rooms.set(r._id, clone(r)); },
      grantItems: async (id, entries, key, pending) => { const p = players.get(id); if ((p.partyItemReceipts || []).includes(key)) return; p.partyItemReceipts = [...(p.partyItemReceipts || []), key]; const field = pending ? "partyPendingDrops" : "inventory"; p[field] = [...(p[field] || []), ...clone(entries)]; },
    },
  };
  sc.progressService = new ProgressService({ ensurePlayer: async id => ({ player: { discordId: id }, progress: clone(players.get(id)) }) }, progressRepository);
  let time = 1_000_000;
  const opts = { auto: false, now: () => time, playbackMs: 0, capacity: async () => 0, fightFloor };
  return { sc, opts, rooms, players, gold, advance: (amount = 100000) => { time += amount; } };
}
async function setup(f, difficulty = "normal", count = 2) {
  const service = createPartyTowerRooms(f.sc, f.opts);
  const first = await service.createRoom("party-test-1", "坦", "secret", "tank", difficulty);
  for (let i = 2; i <= count; i++) await service.joinRoom(`party-test-${i}`, `隊友${i}`, first.roomId, "secret", i === 3 ? "support" : "dps");
  for (let i = 1; i <= count; i++) await service.setReady(`party-test-${i}`, true);
  return service;
}
async function main(){
 const f=fixture();f.opts.fightFloor=async session=>{for(const m of session.members){m.equipped.special_1={monsterCardSkill:require('../src/shared/metalCards').skillForMetalMonster(5)};m.currentHp=m.discordId==='party-test-1'?0:Math.floor(m.maxHp*.4);}return {monsterKilled:true,survived:true,memberLogs:[],memberDamage:[],monsterHpFinal:0};};
 let s=await setup(f);await s.startRoom('party-test-1');let r;
 for(let i=0;i<4;i++){f.advance();await s.tick();r=await s.getState('party-test-2');if(r.clearedFloor===1)break;}
 assert.equal(r.clearedFloor,1);assert.equal(r.members.find(m=>m.discordId==='party-test-1').hp,0);
 const live=r.members.find(m=>m.discordId==='party-test-2');assert.equal(live.hp,Math.floor(live.maxHp*.4)+Math.floor(live.maxHp*.05));
 assert.equal(r.lastFloorResult.metalRecovery.length,1);assert.equal(r.lastFloorResult.metalRecovery[0].healed,Math.floor(live.maxHp*.05));assert.equal(r.lastFloorResult.members.find(m=>m.name===live.name).hp,live.hp);
 s.close();s=createPartyTowerRooms(f.sc,f.opts);assert.equal((await s.getState('party-test-2')).members.find(m=>m.discordId==='party-test-2').hp,live.hp);s.close();
 console.log('PASS real party settlement: 5% heal, dead excluded, result HP and durable reload');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
