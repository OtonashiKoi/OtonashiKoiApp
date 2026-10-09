"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs');
const {NormalLiveCombat}=require('../src/services/realtime/normalLiveCombat');
const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
const riichi=require('../src/services/realtime/liveRiichi'),rules=require('../src/shared/hutaoRiichiCard');
const potions=require('../src/services/realtime/liveBattlePotions'),entry=require('../src/services/realtime/hutaoLiveEntry');
const {runCombatLoop}=require('../src/shared/combatLoop');
const zone=entry.ZONE,checks=[],oldRandom=Math.random;
const stats={atk:100,maxHp:10000,str:0,agi:1,vit:0,int:0,dex:100,luk:0,level:65,hit:100,dodge:0,crit:0,combo:0,def:0,flatDef:0,dmgMin:1,dmgMax:1};
function fixture(){
 let now=1000,state={activeMonsterSeq:1,normalLiveSpawnAt:1000,currentHp:1000000,damageMap:{},participants:[]},fail=false,failProgress=false,writeCount=0,wipeCount=0;
 const progress=new Map(),gold=new Map(),operations=new Map(),monster={id:'hutao-fixture',seq:1,name:'胡桃',zone,calc:{...stats,atk:30,maxHp:1000000}};
 const sc={worldBossServiceFor:()=>({markBossWiped:async()=>{wipeCount++;}}),progressRepository:{findByPlayerId:async id=>structuredClone(progress.get(id)),updateFields:async(id,fields)=>{writeCount++;Object.assign(progress.get(id),structuredClone(fields));},saveIfUnchanged:async(next,expected)=>{if(failProgress||progress.get(next.playerId).updatedAt!==expected)return false;progress.set(next.playerId,structuredClone(next));return true;}},
 monsterService:{getState:async()=>structuredClone(state),listMonsters:async()=>[monster],saveStateIfActiveMonster:async(next,z,seq,hp)=>{if(fail||state.activeMonsterSeq!==seq||state.currentHp!==hp)return false;state=structuredClone(next);return true;}},
 rewardService:{grantCurrency:async input=>{const previous=operations.get(input.sourceRef);if(previous){if(previous.error)throw previous.error;return previous;}
 if((gold.get(input.discordId)||0)+input.amount<0){const error=Object.assign(Error('gold insufficient'),{code:'INSUFFICIENT_BALANCE'});operations.set(input.sourceRef,{error});throw error;}
 gold.set(input.discordId,(gold.get(input.discordId)||0)+input.amount);operations.set(input.sourceRef,input);return input;}}};
 const scene=new ZoneCombatScene({now:()=>now,emit:()=>{}}),engine=new NormalLiveCombat({now:()=>now,auto:false,starterNpcs:false,scene,emit:()=>{}});
 function add(id,extra={}){progress.set(id,{playerId:id,activeCharacterSlot:1,seasonKey:'test',inventory:[],updatedAt:'0',...extra});gold.set(id,100000);}
 async function join(id,card=false,extra={}){const promise=engine.join({sc,zone,monster,actorId:id,actorName:id,stats:{...stats,...extra},monsterStats:monster.calc,options:{playerName:id,playerLevel:65,equipped:card?{special_1:{monsterCardSkill:{key:'hutao_riichi'}}}:{}}});promise.catch(()=>{});await engine.queues.get(zone);return {promise,actor:engine.players.get(id)};}
 return {sc,engine,scene,add,join,progress,gold,operations,state:()=>state,time:n=>now=n,now:()=>now,setState:s=>state=structuredClone(s),fail:v=>fail=v,failProgress:v=>failProgress=v,writes:()=>writeCount,wipes:()=>wipeCount,close:()=>{const r=engine.zones.get(zone);if(r&&!r.closed)engine.failRoom(r,Error('fixture completed'));}};
}
async function check(name,fn){try{await fn();checks.push({name,passed:true});console.log('PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});console.error('FAIL',name,e.stack);}}
(async()=>{Math.random=()=>.49;
await check('opening 50% tsumo: only holder four 30% ATK hits; party AGI+15; no basic or other turn on timer',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A',true);await f.join('B');await f.engine.advance(zone);
 assert.equal(f.state().currentHp,999880);assert.equal(f.state().damageMap.A.damage,120);assert.equal(f.state().damageMap.B,undefined);
 assert.equal(f.engine.players.get('A').attacks,0);assert.equal(f.state().normalLive.actors.B.riichi.agiUntil,16000);
 assert.equal(rules.timedStats(stats,f.progress.get('B').hutaoRiichi,15999).agi,16);assert.equal(rules.timedStats(stats,f.progress.get('B').hutaoRiichi,16000).agi,1);
 assert.ok(f.scene.publicSnapshot(f.scene.scenes.get(zone)).events.some(e=>e.fx==='tsumo'));
 const written=f.writes();await riichi.flush(f.sc,f.state());assert.equal(f.writes(),written,'same committed buff must not repeatedly rewrite progress');f.close();
});
await check('50% boundary misses: current HP cost 10%, party LUK+5 for exactly 15s, no attack/extra proc',async()=>{
 Math.random=()=>.5;const f=fixture();f.add('A');f.add('B');await f.join('A',true);await f.join('B');let s=f.state();s.normalLive.actors.A.hp=137;f.setState(s);f.engine.players.get('A').hp=137;await f.engine.advance(zone);
 assert.equal(f.state().normalLive.actors.A.hp,124);assert.equal(f.state().currentHp,1000000);assert.equal(f.state().normalLive.actors.B.riichi.lukUntil,16000);
 assert.equal(rules.timedStats(stats,f.progress.get('B').hutaoRiichi,15999).luk,5);assert.equal(rules.timedStats(stats,f.progress.get('B').hutaoRiichi,16000).luk,0);f.close();Math.random=()=>.49;
});
await check('20s absolute interval, no early repeat; two holders refresh same bonus without stacking',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A',true);await f.join('B',true);await f.engine.advance(zone);
 assert.equal(f.state().currentHp,999760);assert.equal(rules.timedStats(stats,f.state().normalLive.actors.A.riichi,1000).agi,16);
 for(const a of f.engine.players.values())a.attackAt=999999;const room=f.engine.zones.get(zone);room.enemyAt=999999;
 f.time(20999);await f.engine.advance(zone);assert.equal(f.state().currentHp,999760);
 f.time(21000);await f.engine.advance(zone);assert.equal(f.state().currentHp,999520);assert.equal(f.progress.get('A').hutaoRiichi.nextAt,41000);f.close();
});
await check('buff survives monster change until expiry; stale old character updates do not leak',async()=>{
 const f=fixture();f.add('A');await f.join('A',true);await f.engine.advance(zone);const original=f.progress.get('A').hutaoRiichi;f.close();
 assert.equal(rules.timedStats(stats,original,15999).agi,16);assert.equal(rules.timedStats(stats,original,16000).agi,1);
 f.progress.get('A').activeCharacterSlot=2;f.progress.get('A').hutaoRiichi={nextAt:1};await riichi.flush(f.sc,f.state());assert.equal(f.progress.get('A').hutaoRiichi.nextAt,1);
});
await check('party buff includes downed teammates; revival retains remaining absolute buff time',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A',true);await f.join('B');const s=f.state();s.normalLive.actors.B.hp=0;s.normalLive.actors.B.active=false;f.setState(s);f.engine.players.get('B').hp=0;await f.engine.advance(zone);
 assert.equal(f.state().normalLive.actors.B.riichi.agiUntil,16000);assert.equal(f.state().normalLive.actors.B.hp,0);assert.equal(rules.timedStats(stats,f.progress.get('B').hutaoRiichi,15999).agi,16);f.close();
});
await check('resumed core uses current AGI/LUK/ATK and wind, restores expired stats without extra turn',async()=>{
 const session={},base={actionSession:session,liveNormalCombat:true,skipMonsterAttack:true,playerName:'A',playerLevel:65,equipped:{},startPlayerHp:10000,startMonsterHp:1000000};
 const first=runCombatLoop({...stats},{...stats},'胡桃',1000000,15,{...base,riichiOnly:true,hutaoRiichiPulse:true,livePlayerStats:{...stats,atk:200},liveMonsterStats:{...stats},bossVulnMult:1.35});
 assert.equal(first.totalDamage,324);assert.equal(first.combatStats.attackRounds,0);
 const second=runCombatLoop({...stats},{...stats},'胡桃',1000000,15,{...base,startMonsterHp:first.finalMonsterHp,riichiOnly:true,hutaoRiichiPulse:true,livePlayerStats:stats,liveMonsterStats:stats,bossVulnMult:1});assert.equal(second.totalDamage,120);assert.equal(second.combatStats.attackRounds,0);
});
await check('entry 50k once; duplicate join/cooldown reject without extra debit; insufficient funds clears pending',async()=>{
 const f=fixture();f.add('A');await f.join('A');assert.equal(f.gold.get('A'),50000);assert.equal(f.progress.get('A').hutaoChallengeUntil,0);
 await assert.rejects(f.engine.join({sc:f.sc,zone,monster:f.engine.zones.get(zone).monster,actorId:'A'}),/即時戰鬥/);assert.equal(f.gold.get('A'),50000);
 f.close();const next=await entry.prepare(f.sc,'A','A','next-operation',2000);assert.equal(f.gold.get('A'),0);await entry.abort(f.sc,'A','A',next);assert.equal(f.gold.get('A'),50000);
 f.add('poor');f.gold.set('poor',49999);await assert.rejects(entry.prepare(f.sc,'poor','poor','poor-operation',1000),/insufficient/);assert.equal(f.gold.get('poor'),49999);assert.equal(f.progress.get('poor').hutaoEntryPending,null);
 f.gold.set('poor',100000);await entry.prepare(f.sc,'poor','poor','funded-operation',1000);assert.equal(f.gold.get('poor'),50000);
});
await check('failed admission CAS refunds exactly once; interrupted debit recovery has no free refund',async()=>{
 const f=fixture();f.add('A');f.fail(true);const p=f.engine.join({sc:f.sc,zone,monster:{id:'hutao-fixture',name:'胡桃',seq:1,calc:stats},actorId:'A',actorName:'A',stats,monsterStats:stats,options:{equipped:{}}});await assert.rejects(p);assert.equal(f.gold.get('A'),100000);assert.equal(f.progress.get('A').hutaoEntryPending,null);
 f.fail(false);const pending=await entry.prepare(f.sc,'A','A','interrupted-entry',1000);assert.equal(f.gold.get('A'),50000);
 await entry.prepare(f.sc,'A','A','new-entry',2000);assert.equal(f.gold.get('A'),50000);assert.equal(f.operations.size,5);
});
await check('loadout max10 including ten revive; ownership/stack quantities; invalid plans do not save',async()=>{
 const f=fixture();f.add('A',{inventory:[{uuid:'revive-stack',itemId:'c4794326-ced1-4efe-983d-17c14ee2f2f8',stackCount:10}]});
 assert.equal(potions.validate({'c4794326-ced1-4efe-983d-17c14ee2f2f8':10},f.progress.get('A').inventory)[0].remaining,10);
 await assert.rejects(potions.configure(f.sc,'A',{'c4794326-ced1-4efe-983d-17c14ee2f2f8':11},f.engine));await assert.rejects(potions.configure(f.sc,'A',{'c4794326-ced1-4efe-983d-17c14ee2f2f8':1.5},f.engine));assert.equal(f.progress.get('A').combatPotionPlan,undefined);
 await potions.configure(f.sc,'A',{'c4794326-ced1-4efe-983d-17c14ee2f2f8':10},f.engine);assert.equal(f.progress.get('A').combatPotionPlan['c4794326-ced1-4efe-983d-17c14ee2f2f8'],10);
});
await check('persistent refill targets carry available stacks on every entry without consuming at admission',async()=>{
 const heal='3eb1d302-3d04-40a5-8335-1f9ed844dc27',revive='c4794326-ced1-4efe-983d-17c14ee2f2f8',f=fixture();f.add('A');
 await potions.configure(f.sc,'A',{[heal]:5,[revive]:5},f.engine);assert.deepEqual(f.progress.get('A').combatPotionPlan,{[heal]:5,[revive]:5});
 const empty=await entry.prepare(f.sc,'A','A','empty-refill-entry',1000);assert.deepEqual(empty.pouch,[]);await entry.abort(f.sc,'A','A',empty);
 f.progress.get('A').inventory=[{uuid:'heal-one',itemId:heal,stackCount:2},{uuid:'heal-two',itemId:heal,stackCount:1},{uuid:'revive-one',itemId:revive,stackCount:7}];
 const before=structuredClone(f.progress.get('A').inventory),partial=await entry.prepare(f.sc,'A','A','partial-refill-entry',2000);
 assert.equal(partial.pouch.filter(p=>p.itemId===heal).reduce((n,p)=>n+p.remaining,0),3);assert.equal(partial.pouch.filter(p=>p.itemId===revive).reduce((n,p)=>n+p.remaining,0),5);assert.deepEqual(f.progress.get('A').inventory,before);await entry.commit(f.sc,'A',partial);
 f.progress.get('A').inventory[0].stackCount=6;
 const replenished=await entry.prepare(f.sc,'A','A','full-refill-entry',partial.op.until);
 assert.equal(replenished.pouch.reduce((n,p)=>n+p.remaining,0),10);assert.equal(replenished.pouch.find(p=>p.itemId===heal).remaining,5);assert.equal(f.progress.get('A').combatPotionPlan[heal],5);assert.equal(f.progress.get('A').inventory[0].stackCount,6);await entry.abort(f.sc,'A','A',replenished);
 assert.throws(()=>potions.validate(JSON.parse('{"__proto__":1}'),[],{allowShortage:true}),/種類/);assert.throws(()=>potions.validate({[heal]:11},[],{allowShortage:true}),/最多/);
});
await check('downed remains in Hutao; revive another actor consumes one; duplicate request and mismatched retries',async()=>{
 const f=fixture();f.add('A',{inventory:[{uuid:'revive-stack',itemId:'c4794326-ced1-4efe-983d-17c14ee2f2f8',stackCount:3}],combatPotionPlan:{'c4794326-ced1-4efe-983d-17c14ee2f2f8':3}});f.add('B');await f.join('A');await f.join('B',false,{maxHp:1});f.time(2500);await f.engine.advance(zone);
 assert.equal(f.state().normalLive.actors.B.hp,0);assert.equal(f.engine.players.get('B').done,false);const room=f.engine.zones.get(zone),req={battleId:f.engine.players.get('A').id,operationId:'revive-operation-1',itemId:'c4794326-ced1-4efe-983d-17c14ee2f2f8',targetId:'B'};
 await potions.use(f.engine,room,'A',req);assert.equal(f.state().normalLive.actors.B.hp,1);assert.equal(f.progress.get('A').inventory[0].stackCount,2);assert.equal(f.state().normalLiveDeath.B,undefined);
 await potions.use(f.engine,room,'A',req);assert.equal(f.progress.get('A').inventory[0].stackCount,2);await assert.rejects(potions.use(f.engine,room,'A',{...req,targetId:'A'}),/不同用藥/);
 await assert.rejects(potions.use(f.engine,room,'A',{...req,operationId:'revive-operation-2'}),/尚未倒地/);assert.equal(f.progress.get('A').inventory[0].stackCount,2);f.close();
});
await check('downed actor cannot leave or re-enter while teammate lives, including after old cooldown',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A');await f.join('B',false,{maxHp:1});f.time(2500);await f.engine.advance(zone);
 const battleId=f.engine.players.get('B').id,fee=f.gold.get('B');f.time(35000);
 await assert.rejects(f.engine.leave('B',battleId),/等待隊友使用復活藥/);
 await assert.rejects(f.join('B'),/即時戰鬥/);
 assert.equal(f.gold.get('B'),fee);assert.equal(f.engine.players.get('B').done,false);f.close();
});
await check('full party wipe resets Hutao HP, damage and encounter; everyone can pay to retry',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A');await f.join('B');f.time(1300);await f.engine.advance(zone);
 assert.ok(f.state().currentHp<1000000);const oldKey=f.state().normalLive.encounterKey;
 const next=f.state();for(const id of ['A','B']){next.normalLive.actors[id].hp=1;f.engine.players.get(id).hp=1;}f.setState(next);
 f.time(2500);await f.engine.advance(zone);
 assert.equal(f.state().currentHp,1000000);assert.deepEqual(f.state().damageMap,{});assert.deepEqual(f.state().participants,[]);
 assert.equal(f.state().normalLive.wipedAt,2500);assert.equal(f.state().normalLive.actors.A.recoverAt,0);assert.deepEqual(f.state().normalLiveDeath,{});
 assert.equal(f.wipes(),1);
 assert.equal(f.engine.players.size,0);assert.equal(f.engine.zones.get(zone).closed,true);
 assert.equal(f.scene.scenes.get(zone).liveHp,1000000);
 const a=await f.join('A');assert.notEqual(f.state().normalLive.encounterKey,oldKey);
 assert.equal(f.gold.get('A'),0);assert.equal(a.actor.hp,a.actor.maxHp);f.close();
});
await check('last living teammate retreat releases stranded downed players into full HP retry',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A');await f.join('B',false,{maxHp:1});f.time(2500);await f.engine.advance(zone);
 assert.equal(f.state().normalLive.actors.B.hp,0);
 const left=await f.engine.leave('A',f.engine.players.get('A').id);assert.equal(left.left,true);
 assert.equal(f.state().currentHp,1000000);assert.equal(f.state().normalLive.wipedAt,2500);assert.equal(f.wipes(),1);
 assert.equal(f.engine.players.has('B'),false);assert.equal(f.engine.vitals.get('B').recoverAt,0);
 await f.join('B');assert.equal(f.gold.get('B'),0);f.close();
});
await check('heal preserves attack cadence; full/dead target and cooldown do not consume',async()=>{
 const f=fixture();f.add('A',{inventory:[{uuid:'heal-stack',itemId:'3eb1d302-3d04-40a5-8335-1f9ed844dc27',stackCount:3}],combatPotionPlan:{'3eb1d302-3d04-40a5-8335-1f9ed844dc27':3}});f.add('B');await f.join('A');await f.join('B');const room=f.engine.zones.get(zone),req={battleId:f.engine.players.get('A').id,operationId:'heal-operation-1',itemId:'3eb1d302-3d04-40a5-8335-1f9ed844dc27',targetId:'B'};
 await assert.rejects(potions.use(f.engine,room,'A',req),/已滿/);const s=f.state();s.normalLive.actors.B.hp=1;f.setState(s);f.engine.players.get('B').hp=1;const attackAt=f.engine.players.get('B').attackAt;
 await potions.use(f.engine,room,'A',req);assert.equal(f.engine.players.get('B').attackAt,attackAt);assert.equal(f.progress.get('A').inventory[0].stackCount,2);
 await assert.rejects(potions.use(f.engine,room,'A',{...req,operationId:'heal-operation-2'}),/冷卻|已滿/);assert.equal(f.progress.get('A').inventory[0].stackCount,2);f.close();
});
await check('potion result CAS fails after consumption: durable intent recovers exactly once, including restart',async()=>{
 const f=fixture();f.add('A',{inventory:[{uuid:'heal-stack',itemId:'3eb1d302-3d04-40a5-8335-1f9ed844dc27',stackCount:3}],combatPotionPlan:{'3eb1d302-3d04-40a5-8335-1f9ed844dc27':3}});f.add('B');await f.join('A');await f.join('B');let s=f.state();s.normalLive.actors.B.hp=1;f.setState(s);const room=f.engine.zones.get(zone),save=f.sc.monsterService.saveStateIfActiveMonster;let writes=0;
 f.sc.monsterService.saveStateIfActiveMonster=async(...args)=>++writes===2?false:save(...args);
 const req={battleId:f.engine.players.get('A').id,operationId:'pending-operation-1',itemId:'3eb1d302-3d04-40a5-8335-1f9ed844dc27',targetId:'B'};
 await assert.rejects(potions.use(f.engine,room,'A',req),/等待存檔/);assert.equal(f.progress.get('A').inventory[0].stackCount,2);assert.ok(f.state().pendingLivePotion);
 await potions.recover({...room,members:new Map()},f.engine,f.state());assert.equal(f.progress.get('A').inventory[0].stackCount,2);assert.equal(f.state().pendingLivePotion,null);
 await potions.use(f.engine,room,'A',req);assert.equal(f.progress.get('A').inventory[0].stackCount,2);assert.equal(f.state().livePotionReceipts.length,1);f.close();
});
await check('lost inventory before consumption cancels pending intent without freezing room or charging',async()=>{
 const f=fixture();f.add('A',{inventory:[{uuid:'heal-stack',itemId:'3eb1d302-3d04-40a5-8335-1f9ed844dc27',stackCount:3}],combatPotionPlan:{'3eb1d302-3d04-40a5-8335-1f9ed844dc27':3}});f.add('B');await f.join('A');await f.join('B');let s=f.state();s.normalLive.actors.B.hp=1;f.setState(s);const room=f.engine.zones.get(zone),save=f.sc.monsterService.saveStateIfActiveMonster;
 f.sc.monsterService.saveStateIfActiveMonster=async(...args)=>{const ok=await save(...args);if(ok&&args[0].pendingLivePotion)f.progress.get('A').inventory=[];return ok;};
 await assert.rejects(potions.use(f.engine,room,'A',{battleId:f.engine.players.get('A').id,operationId:'missing-potion-operation',itemId:'3eb1d302-3d04-40a5-8335-1f9ed844dc27',targetId:'B'}),/不在背包/);
 assert.equal(f.state().pendingLivePotion,null);assert.equal(f.state().normalLive.actors.B.hp,1);assert.equal(f.progress.get('A').livePotionReceipts,undefined);f.close();
});
await check('revive resumes same core ledger and class/card state instead of restarting battle',async()=>{
 const session={},opts={actionSession:session,allowCoopRevive:true,liveNormalCombat:true,playerName:'A',playerLevel:65,equipped:{},startPlayerHp:10000,startMonsterHp:1000000,skipMonsterAttack:true};
 const first=runCombatLoop({...stats},{...stats,atk:100000},'胡桃',1000000,15,opts);assert.ok(first.totalDamage>0);
 const death=runCombatLoop({...stats},{...stats,atk:100000},'胡桃',1000000,15,{...opts,startPlayerHp:1,startMonsterHp:first.finalMonsterHp,skipMonsterAttack:false,skipPlayerAttack:true,monsterActionRound:2});assert.equal(death.finalPlayerHp,0);assert.equal(death.actionComplete,false);assert.equal(death.cumulative.totalDamage,first.totalDamage);
 const resumed=runCombatLoop({...stats},{...stats,atk:100000},'胡桃',1000000,15,{...opts,startPlayerHp:5000,startMonsterHp:death.finalMonsterHp});assert.equal(resumed.cumulative.totalDamage,first.totalDamage+resumed.totalDamage);assert.equal(resumed.cumulative.combatStats.attackRounds,2);
});
await check('CAS rejection does not publish tsumo or persist buffs',async()=>{
 const f=fixture();f.add('A');await f.join('A',true);f.fail(true);await f.engine.advance(zone);assert.equal(f.progress.get('A').hutaoRiichi,undefined);assert.equal(f.state().currentHp,1000000);assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).events.filter(e=>e.fx==='tsumo').length,0);
});
Math.random=oldRandom;const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(output)fs.writeFileSync(output,JSON.stringify({productionWrites:false,checks},null,2));if(checks.some(c=>!c.passed))process.exitCode=1;
})().catch(e=>{Math.random=oldRandom;console.error(e);process.exitCode=1;});
