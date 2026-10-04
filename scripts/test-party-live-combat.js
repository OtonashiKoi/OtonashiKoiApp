"use strict";
const assert = require("node:assert/strict"), fs = require("fs"), crypto = require("crypto");
const { createLiveCombat } = require("../src/services/tower/partyTowerLiveCombat");
const { fixture, setup } = require("./test-party-tower-v2");
const { createPartyTowerRooms } = require("../src/services/tower/partyTowerRoomsV2");
const { loadBson } = require("./verify-normal-progression");
const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11), output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
if (!snapshot || !output) throw Error("snapshot and output required");
const items = loadBson(`${snapshot}/items.bson`), checks = [];
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); } catch(e) { checks.push({ name, ok: false, error: e.stack }); } finally { require("../src/shared/battlePresence").setTowerPresence(Array.from({length:7},(_,i)=>`party-test-${i+1}`),false); } }
const clone = structuredClone;
const stats = { atk: 100, maxHp: 100000, agi: 40, dex: 20, level: 40, int: 10, def: 0, flatDef: 0, hit: 100, dodge: 0, crit: 0, dmgMin: 1, dmgMax: 1 };
const member = (id, badge, role = "dps") => ({ discordId:id, name:id, level:40, partyV2:true, towerRole:role, stats:clone(stats), equipped:{job_eq:{...items.find(i=>i.id===badge),itemId:badge}}, inventory:[], currentHp:stats.maxHp,maxHp:stats.maxHp,strategy:{stance:"attack",sacrifice:false} });
const monster = { name:"測試魔物",zone:"ancient_city_deep",calc:{...stats,agi:1,atk:1,maxHp:1e7} };
function begin(members) { const room={_id:"live-test",runId:"run-test",members:clone(members)};const engine=createLiveCombat();engine.initialize(room,monster,1,1000);room.liveCombat.seed=937451;return {room,engine}; }
async function main() {
 await check("同一種子逐次戰鬥與重啟重播完全一致；未提交出手不重扣傷害或資源",()=>{
   const {room,engine}=begin([member("tank","job_holyblade_t2_v1","tank"),member("bard","job_minstrel_t2_v1")]);
   for(let i=0;i<15;i++) engine.advance(room,1000+i*1000);
   const saved=clone(room), oldRandom=Math.random, oldNow=Date.now;
   // Simulate an action whose room write fails: the new engine must discard it.
   const expected=engine.advance(room,20000);
   const restored=createLiveCombat(), actual=restored.advance(saved,20000);
   assert.deepEqual(actual,expected);assert.deepEqual(saved.members,room.members);
   assert.equal(Math.random,oldRandom);assert.equal(Date.now,oldNow);
 });
 await check("戰中完美演奏加成套用下一次詩人出手，完美和弦只觸發一次且無需換怪",()=>{
   const a=begin([member("bard","job_minstrel_t2_v1")]),b=begin([member("bard","job_minstrel_t2_v1")]);
   const first=a.engine.advance(a.room,1000);assert.equal(first.action.actorId,"bard");b.engine.advance(b.room,1000);
   a.room.members[0].strategy.bardResult={dmgMult:1.5,chordPct:170,note:"完美演奏"};a.room.members[0].strategy.bardPerformanceId="new-score";a.room.members[0].bardStreak=1;
   let baseDamage=0,boostDamage=0,chords=0;
   for(let i=0;i<8;i++) {const beforeA=a.room.lastHp??first.action.monsterHpAfter,beforeB=b.room.lastHp??first.action.monsterHpAfter;const ra=a.engine.advance(a.room,2000+i*1000),rb=b.engine.advance(b.room,2000+i*1000);a.room.lastHp=ra.action.monsterHpAfter;b.room.lastHp=rb.action.monsterHpAfter;if(ra.action.actorId==="bard"){boostDamage+=beforeA-ra.action.monsterHpAfter;baseDamage+=beforeB-rb.action.monsterHpAfter;chords+=ra.action.logs.join("\n").includes("完美和弦")?1:0;}}
   assert.ok(boostDamage>baseDamage);assert.equal(chords,1);
   const restarted=clone(a.room);assert.deepEqual(createLiveCombat().advance(restarted,15000),a.engine.advance(a.room,15000));
 });
 await check("戰中血祭開啟於下一次出手扣HP一次，關閉後移除攻擊加成；無需重置戰鬥",()=>{
   const a=begin([member("war","job_berserker_t2_v1")]);a.engine.advance(a.room,1000);
   const before=a.room.members[0].currentHp;a.room.members[0].strategy={sacrifice:true,sacrificeActivationId:"blood-1"};
   let paid=0;for(let i=0;i<8;i++){const r=a.engine.advance(a.room,2000+i*1000);paid+=r.action.logs.join("\n").includes("你剖開自己")?1:0;}
   assert.equal(paid,1);assert.ok(a.room.members[0].currentHp<before-10000);
   a.room.members[0].strategy.sacrifice=false;a.engine.advance(a.room,12000);assert.ok(!a.room.members[0].activeEffects.some(e=>e.sourceType==="blood_sacrifice"));
 });
 await check("真正房間逐次運算、戦中策略與用藥立即延續、倒地鎖、重連續跑",async()=>{
   const f=fixture();delete f.opts.fightFloor;delete f.opts.playbackMs;
   f.players.get("party-test-3").equipment.job_eq={...items.find(i=>i.id==="job_minstrel_t2_v1"),itemId:"job_minstrel_t2_v1"};
   const ids=Object.keys(require("../src/bot/handlers/towerHandlers").TOWER_POTION_IDS);f.players.get("party-test-1").inventory=[{uuid:"heal",itemId:ids[0],stackCount:5}];
   const list=f.sc.monsterService.listMonsters;f.sc.monsterService.listMonsters=async()=>(await list()).map(m=>({...m,calc:{...m.calc,maxHp:1e7}}));
   let s=await setup(f,"normal",3);await s.setPotions("party-test-1",{[ids[0]]:5});await s.setReady("party-test-1");await s.startRoom("party-test-1");await s.tick();
   let r=await s.getState("party-test-1");assert.equal(r.clearedFloor,0);assert.equal(r.lastFloorResult.memberLogs.length,1);assert.ok([...f.rooms.values()][0].liveCombat);await s.tick();assert.equal((await s.getState("party-test-1")).lastFloorResult.memberLogs.length,1);
   const bard=await s.getState("party-test-3"),q=bard.strategyControls.bardChallenge;await s.setStrategy("party-test-3",{runId:r.runId,bardInput:{token:q.token,inputs:q.seq}});await assert.rejects(s.setStrategy("party-test-3",{runId:r.runId,bardInput:{token:q.token,inputs:q.seq}}),/失效/);
   [...f.rooms.values()][0].members[0].currentHp-=100;await s.usePartyItem("party-test-1",ids[0],"party-test-1",{runId:r.runId,operationId:"healing-operation"});const hp=(await s.getState("party-test-1")).members[0].hp;
   s.close();s=createPartyTowerRooms(f.sc,f.opts);f.advance(2000);await s.tick();r=await s.getState("party-test-1");assert.equal(r.lastFloorResult.memberLogs.length,2);assert.equal(r.members[0].hp,hp);assert.ok(!r.failReason);
   [...f.rooms.values()][0].members[2].currentHp=0;await assert.rejects(s.setStrategy("party-test-3",{runId:r.runId}),/倒地/);f.advance(2000);await s.tick();assert.equal((await s.getState("party-test-1")).members[2].hp,0);assert.equal((await s.getState("party-test-3")).strategyControls.bardChallenge,null);
   await s.disband("party-test-1");s.close();
 });
 const membersPath=process.argv.find(a=>a.startsWith("--members="))?.slice(10);
 if(membersPath) await check("從1等實得40等隊伍：5種正式BOSS各4種子，逐次運算與完整核心傷害／HP／技能一致",async()=>{
   const {MonsterService}=require("../src/services/monster/monsterService"),rules=require("../src/shared/partyTowerRules"),core=require("../src/bot/handlers/towerHandlers");
   const pool=await new MonsterService({findAll:async()=>loadBson(`${snapshot}/monsters.bson`)}).listMonsters();
   const bosses=pool.filter(m=>m.isBoss&&m.level===50&&m.enabled!==false&&["ancient_city_deep","dragon_realm","hellfire","metal_mine"].includes(m.zone));assert.equal(bosses.length,5);
   for(const boss of bosses) for(let seed=937451;seed<937455;seed++){
     const members=JSON.parse(fs.readFileSync(membersPath)),scaled=rules.scaleMonster(boss,"challenge");core.refreshTowerMemberMaxHp({members},5,{zone:boss.zone});
     const {room,engine}=begin(members);room.liveCombat.monster=clone(scaled);room.liveCombat.floor=5;room.liveCombat.seed=seed;
     const oldRandom=Math.random,oldNow=Date.now;let state=seed>>>0;
     Math.random=()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};Date.now=()=>1e6;
     let expected;const baselineMembers=clone(members);
     try{expected=await core.fightFloor({partyV2:true,currentFloor:5,members:baselineMembers},scaled,scaled.calc.maxHp,scaled.calc.atk)}finally{Math.random=oldRandom;Date.now=oldNow;}
     const logs=[];let final;
     for(let i=0;i<5001;i++){const next=engine.advance(room,1e6);if(next.action)logs.push(next.action);if(next.result){final=next.result;break}}
     assert.deepEqual(logs,expected.memberLogs,boss.name+" seed "+seed);assert.deepEqual(final,expected);assert.deepEqual(room.members,baselineMembers);
   }
 });
 fs.writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),snapshot,sourceHash:crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),checks},null,2));checks.forEach(c=>console.log(c.ok?"PASS":"FAIL",c.name,c.error||""));process.exit(checks.some(c=>!c.ok)?1:0);
}
main().catch(e=>{console.error(e);process.exit(1)});
