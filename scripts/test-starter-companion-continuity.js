'use strict';
require('dotenv').config({quiet:true});
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const snapshot=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11),out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
if(!snapshot||!out)throw Error('--snapshot and --out required');
const testDb='qa_npc_continuity_'+Date.now();process.env.MONGODB_DB_NAME=testDb;
const {BSON}=require('mongodb');
const readBson=file=>{const bytes=fs.readFileSync(file),rows=[];for(let i=0;i<bytes.length;){const size=bytes.readInt32LE(i);rows.push(BSON.deserialize(bytes.subarray(i,i+size)));i+=size;}return rows;};
const items=readBson(snapshot+'/items.bson'),monsters=readBson(snapshot+'/monsters.bson');
const {NormalLiveCombat}=require('../src/services/realtime/normalLiveCombat');
const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
const {ensureStarterRoom}=require('../src/services/realtime/starterCompanionRooms');
const {ZONES}=require('../src/services/realtime/starterCompanions');
const sourceFiles=['src/services/realtime/starterCompanions.js','src/services/realtime/starterCompanionCombat.js','src/services/realtime/starterCompanionRooms.js','src/services/realtime/normalLiveCombat.js','src/services/realtime/normalLiveRecovery.js','src/services/realtime/monsterActionClock.js','src/services/battle/monsterKillSettlement.js'];
const hashes=()=>sourceFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
const sources=hashes(),checks=[],originalRandom=Math.random;Math.random=()=>0.5;
function fixture(zone='normal',atk=1){
 let now=1000,fail=false,state={activeMonsterSeq:1,currentHp:100000,normalLiveSpawnAt:1000,killCount:{},damageMap:{},participants:[]};
 const monster={id:'fixture-enemy',seq:1,name:'連續參戰邊界怪',zone,level:ZONES[zone]?.level||30,calc:{maxHp:100000,atk,agi:1,hit:100,dodge:0,crit:0,def:0,flatDef:0,dmgMin:1,dmgMax:1}};
 monster.drops=monsters.filter(m=>m.zone===zone).flatMap(m=>m.drops||[]);
 const sc={itemService:{listItems:async()=>items},monsterService:{getState:async()=>structuredClone(state),listMonsters:async()=>[monster],saveStateIfActiveMonster:async(next,z,seq,hp)=>{if(fail||state.currentHp!==hp)return false;state=structuredClone(next);return true;}}};
 const scene=new ZoneCombatScene({now:()=>now,emit:()=>{}}),engine=new NormalLiveCombat({now:()=>now,scene,auto:false,emit:()=>{}}),pending=[];
 const join=id=>{const p=engine.join({sc,zone,monster,actorId:id,actorName:id,stats:{maxHp:100000,atk:10,agi:1,hit:100,dodge:0,crit:0,def:0,flatDef:0,dmgMin:1,dmgMax:1},monsterStats:monster.calc,options:{playerName:id,playerLevel:monster.level,equipped:{},inventory:[]}});p.catch(()=>{});pending.push(p);return p;};
 return {zone,sc,engine,scene,monster,join,state:()=>state,time:t=>{now=t;},set:s=>{state=s;},fail:()=>{fail=true;},stop:async()=>{const r=engine.zones.get(zone);if(r&&!r.closed)engine.failRoom(r,Error('fixture complete'));await Promise.allSettled(pending);}};
}
async function check(name,work){try{await work();checks.push({name,ok:true});console.log('PASS',name);}catch(error){checks.push({name,ok:false,error:error.stack});console.error('FAIL',name,error.message);}}
(async()=>{
 await check('all four zones start named NPC combat with zero humans and no player eligibility',async()=>{
  for(const zone of Object.keys(ZONES)){const f=fixture(zone);await ensureStarterRoom(f.engine,f.sc,zone);assert.equal(f.engine.actorSnapshot(zone).length,2);f.time(1300);await f.engine.advance(zone);assert.ok(f.state().currentHp<100000);assert.deepEqual(f.state().damageMap,{});assert.deepEqual(f.state().participants,[]);assert.deepEqual(f.state().normalLive.actors,{});assert.ok(f.engine.actorSnapshot(zone).every(n=>n.isNpc&&n.name&&!n.name.includes('starter-npc:')));await f.stop();}
 });
 await check('humans replace NPC slots and leaving restores slots without resetting health or attack clocks',async()=>{
  const f=fixture();await ensureStarterRoom(f.engine,f.sc,f.zone);f.time(1300);await f.engine.advance(f.zone);f.time(2500);await f.engine.advance(f.zone);const before=structuredClone(f.state().normalLive.npcs);
  for(const id of ['A','B','C']){f.join(id);await f.engine.queues.get(f.zone);assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.isNpc).length,Math.max(0,3-f.engine.players.size));}
  for(const key of Object.keys(before)){assert.equal(f.state().normalLive.npcs[key].hp,before[key].hp);assert.equal(f.state().normalLive.npcs[key].attackAt,before[key].attackAt);}
  for(const id of ['C','B','A']){await f.engine.leave(id,f.engine.players.get(id).id);assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.isNpc).length,Math.min(2,3-f.engine.players.size));}
  const hp=f.state().currentHp;f.time(5000);await f.engine.advance(f.zone);f.time(5001);await f.engine.advance(f.zone);assert.ok(f.state().currentHp<hp);assert.equal(f.engine.zones.get(f.zone).closed,false);await f.stop();
 });
 await check('dead NPC avatar stays inactive with its recovery deadline through human arrivals and returns after 30 seconds',async()=>{
  const f=fixture('normal',1000);await ensureStarterRoom(f.engine,f.sc,f.zone);f.time(2500);await f.engine.advance(f.zone);const deadline=f.state().normalLive.npcs.archer.recoverAt;assert.equal(deadline,32500);assert.equal(f.engine.actorSnapshot(f.zone).length,2);assert.ok(f.engine.actorSnapshot(f.zone).every(n=>!n.active&&n.baseHp===0&&n.recoverAt===deadline));f.monster.calc.atk=1;
  f.join('A');await f.engine.queues.get(f.zone);assert.equal(f.state().normalLive.npcs.archer.hp,0);assert.equal(f.state().normalLive.npcs.archer.recoverAt,deadline);
  f.time(deadline-1);await f.engine.advance(f.zone);assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.isNpc&&!n.active&&n.recoverAt===deadline).length,2);
  f.time(deadline);await f.engine.advance(f.zone);assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.isNpc).length,2);assert.equal(f.state().normalLive.npcs.archer.attackAt,deadline+300);await f.stop();
 });
 await check('both dead NPCs recover durably without a human joining and resume their next attack',async()=>{
  const f=fixture('normal',1000);await ensureStarterRoom(f.engine,f.sc,f.zone);f.time(2500);await f.engine.advance(f.zone);const deadline=f.state().normalLive.npcs.archer.recoverAt;assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.active).length,0);f.monster.calc.atk=1;
  f.time(deadline-1);await f.engine.advance(f.zone);assert.equal(f.state().normalLive.npcs.archer.hp,0);
  f.time(deadline);await f.engine.advance(f.zone);assert.ok(f.state().normalLive.npcs.archer.hp>0);assert.equal(f.state().normalLive.npcs.archer.selected,true);assert.equal(f.state().normalLive.npcs.archer.recoverAt,0);assert.equal(f.engine.actorSnapshot(f.zone).length,2);
  const hp=f.state().currentHp;f.time(deadline+300);await f.engine.advance(f.zone);assert.ok(f.state().currentHp<hp);assert.deepEqual(f.state().normalLive.actors,{});assert.deepEqual(f.state().damageMap,{});await f.stop();
 });
 await check('NPC-only monster pulses use the monster clock even when NPC attacks are not yet due',async()=>{
  const f=fixture();await ensureStarterRoom(f.engine,f.sc,f.zone);const s=f.state();for(const n of Object.values(s.normalLive.npcs))n.attackAt=5000;f.set(s);f.time(2500);await f.engine.advance(f.zone);
  assert.ok(Object.values(f.state().normalLive.npcs).every(n=>n.enemyTurns===1));assert.equal(f.state().normalLive.monster.turn,1);assert.equal(f.state().currentHp,100000);await f.stop();
 });
 await check('first lethal packet retains human and NPC avatars with durable 30-second deadlines, including closed-room handoff',async()=>{
  const f=fixture('normal',200000);await ensureStarterRoom(f.engine,f.sc,f.zone);f.join('A');await f.engine.queues.get(f.zone);const packets=[];f.scene.publish=s=>packets.push(structuredClone(f.scene.publicSnapshot(s)));f.time(2500);await f.engine.advance(f.zone);
  const death=packets.find(p=>p.actors.some(a=>a.actorId==='A'&&a.baseHp===0));assert.ok(death);assert.equal(death.actors.length,3);assert.ok(death.actors.every(a=>a.baseHp===0&&!a.active&&a.recoverAt===32500));assert.equal(f.engine.recoveryUntil('A'),32500);
  f.engine.close(f.engine.zones.get(f.zone));f.time(32499);assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.isNpc).length,2);assert.equal(f.engine.actorSnapshot(f.zone).find(n=>n.actorId==='A').baseHp,0);f.time(32500);assert.equal(f.engine.actorSnapshot(f.zone).filter(n=>n.isNpc).length,0);await f.stop();
 });
 await check('next encounter and runtime recreation preserve NPC residual HP, recovery, and pending attack cadence',async()=>{
  const f=fixture();await ensureStarterRoom(f.engine,f.sc,f.zone);const state=f.state();state.normalLive.npcs.archer.hp=123;state.normalLive.npcs.bard.hp=0;state.normalLive.npcs.bard.recoverAt=40000;state.normalLive.npcs.bard.selected=false;state.killCount={previous:1};f.set(state);f.engine.close(f.engine.zones.get(f.zone));
  await ensureStarterRoom(f.engine,f.sc,f.zone);assert.equal(f.state().normalLive.npcs.archer.hp,123);assert.equal(f.state().normalLive.npcs.bard.hp,0);assert.equal(f.state().normalLive.npcs.bard.recoverAt,40000);assert.equal(f.state().normalLive.npcs.archer.damage,0);assert.equal(f.state().normalLive.encounterKey,'normal:1:1');assert.equal(f.engine.actorSnapshot(f.zone).find(n=>n.role==='support').recoverAt,40000);
  const restarted=new NormalLiveCombat({now:()=>1000,scene:new ZoneCombatScene({now:()=>1000,emit:()=>{}}),auto:false,emit:()=>{}});await ensureStarterRoom(restarted,f.sc,f.zone);assert.equal(f.state().normalLive.npcs.archer.hp,123);assert.equal(f.state().normalLive.npcs.bard.recoverAt,40000);restarted.close(restarted.zones.get(f.zone));await f.stop();
 });
 await check('NPC admission CAS failure publishes no room, actor, damage, or resource state',async()=>{
  const f=fixture();const before=f.state();f.fail();await ensureStarterRoom(f.engine,f.sc,f.zone);assert.deepEqual(f.state(),before);assert.equal(f.engine.zones.size,0);assert.equal(f.engine.actorSnapshot(f.zone).length,0);
 });
 await check('equipment revision migration preserves living HP ratio, dead recovery, damage and pending cadence',async()=>{
  const f=fixture();await ensureStarterRoom(f.engine,f.sc,f.zone);const state=f.state();Object.assign(state.normalLive.npcs.archer,{revision:'starter-companions-20261006-v2',hp:85,maxHp:425,attackAt:20000,damage:73});Object.assign(state.normalLive.npcs.bard,{revision:'starter-companions-20261006-v2',hp:0,maxHp:425,recoverAt:40000,attackAt:23000,selected:false});f.set(state);
  f.time(1001);f.join('A');await f.engine.queues.get(f.zone);const next=f.state().normalLive.npcs;assert.equal(next.archer.hp,Math.round(next.archer.maxHp*0.2));assert.equal(next.archer.attackAt,20000);assert.equal(next.archer.damage,73);assert.equal(next.bard.hp,0);assert.equal(next.bard.recoverAt,40000);assert.equal(next.bard.attackAt,23000);assert.equal(next.archer.revision,'starter-companions-20261006-v3');await f.stop();
 });
 await check('real Mongo NPC-only kills advance twice and crash recovery retries without players, wallets, quests or unlock credit',async()=>{
  const {getMongoDb}=require('../src/adapters/mongo/createMongoClient'),db=await getMongoDb();assert.equal(db.databaseName,testDb);
  const {createServiceContext}=require('../src/services/createServiceContext'),sc=createServiceContext();const presentation=require('../src/services/battle/battlePresentation');for(const key of ['_republishPanel','_notifyKillRewards','_announceDrops'])presentation[key]=async()=>{};
  await db.collection('items').insertMany(items);
  const monster=await sc.monsterService.createMonster({name:'NPC連戰驗收怪',zone:'beginner',maxHp:20,atk:1,agi:1,level:2,expReward:100,goldReward:50,drops:monsters.filter(m=>m.zone==='beginner').flatMap(m=>m.drops||[]),enabled:true});
  const first={activeMonsterSeq:monster.seq,currentHp:20,coopMaxHp:20,killCount:{},damageMap:{},participants:[]};await sc.monsterRepository.saveState(first,'beginner');
  const engine=new NormalLiveCombat({auto:false,emit:()=>{}});await ensureStarterRoom(engine,sc,'beginner');let state=await sc.monsterService.getState('beginner');state.normalLive.npcs.swordsman.hp=160;await sc.monsterRepository.saveState(state,'beginner');
  const finish=require('../src/services/battle/finishMonsterKill'),realFinish=finish.finishMonsterKill;let crash=true;
  finish.finishMonsterKill=async context=>{if(crash){crash=false;throw Error('injected NPC transition interruption');}return realFinish(context);};
  let firstHitHp;try{await new Promise(r=>setTimeout(r,320));await assert.rejects(engine.advance('beginner'),/injected NPC transition interruption/);firstHitHp=(await sc.monsterService.getState('beginner')).normalLive.npcs.swordsman.hp;await require('../src/services/realtime/normalLiveRecovery').recoverPendingLiveRewards(sc,'beginner');}finally{finish.finishMonsterKill=realFinish;}
  async function waitSpawn(){for(let n=0;n<50;n++){const latest=await sc.monsterService.getState('beginner');if(!latest.activeTransition&&latest.currentHp>0)return latest;await new Promise(r=>setTimeout(r,100));}throw Error('NPC transition did not complete');}
  state=await waitSpawn();assert.equal(state.killCount[monster.id],1);assert.equal(state.normalLive.npcs.swordsman.hp,firstHitHp);assert.ok(firstHitHp>=160&&firstHitHp<275);const secondCount=require('../src/shared/encounterGroup').encounterCount(state,monster);await ensureStarterRoom(engine,sc,'beginner');
  await new Promise(r=>setTimeout(r,320));await engine.advance('beginner');const secondHitHp=(await sc.monsterService.getState('beginner')).normalLive.npcs.swordsman.hp;state=await waitSpawn();assert.equal(state.killCount[monster.id],1+secondCount);assert.equal(state.normalLive.npcs.swordsman.hp,secondHitHp);assert.ok(secondHitHp>=firstHitHp&&secondHitHp<275);
  for(const name of ['players','progress','wallets','transactions','playerQuestProgress'])assert.equal(await db.collection(name).countDocuments({}),0,name+' must stay empty');
  assert.deepEqual(state.damageMap,{});assert.deepEqual(state.participants,[]);assert.deepEqual(state.normalLive.actors,{});engine.close(engine.zones.get('beginner'));
  await db.dropDatabase();
 });
})().finally(()=>{
 Math.random=originalRandom;const sourceDrift=JSON.stringify(sources)!==JSON.stringify(hashes());const report={at:new Date().toISOString(),snapshot,method:'Actual production NPC stats and combat; controlled large-HP lifecycle fixtures plus isolated Mongo real kill, transition and crash recovery',rngConstant:0.5,checks,sources,sourceDrift,ok:!sourceDrift&&checks.every(c=>c.ok)};fs.writeFileSync(out,JSON.stringify(report,null,2));process.exit(report.ok?0:1);
});
