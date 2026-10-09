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
 let now=1000,state={activeMonsterSeq:1,normalLiveSpawnAt:1000,currentHp:1000000,damageMap:{},participants:[]},fail=false,failProgress=false,writeCount=0;
 const progress=new Map(),gold=new Map(),operations=new Map(),monster={id:'hutao-fixture',seq:1,name:'胡桃',zone,calc:{...stats,atk:30,maxHp:1000000}};
 const sc={progressRepository:{findByPlayerId:async id=>structuredClone(progress.get(id)),updateFields:async(id,fields)=>{writeCount++;Object.assign(progress.get(id),structuredClone(fields));},saveIfUnchanged:async(next,expected)=>{if(failProgress||progress.get(next.playerId).updatedAt!==expected)return false;progress.set(next.playerId,structuredClone(next));return true;}},
 monsterService:{getState:async()=>structuredClone(state),listMonsters:async()=>[monster],saveStateIfActiveMonster:async(next,z,seq,hp)=>{if(fail||state.activeMonsterSeq!==seq||state.currentHp!==hp)return false;state=structuredClone(next);return true;}},
 rewardService:{grantCurrency:async input=>{const previous=operations.get(input.sourceRef);if(previous){if(previous.error)throw previous.error;return previous;}
 if((gold.get(input.discordId)||0)+input.amount<0){const error=Object.assign(Error('gold insufficient'),{code:'INSUFFICIENT_BALANCE'});operations.set(input.sourceRef,{error});throw error;}
 gold.set(input.discordId,(gold.get(input.discordId)||0)+input.amount);operations.set(input.sourceRef,input);return input;}}};
 const scene=new ZoneCombatScene({now:()=>now,emit:()=>{}}),engine=new NormalLiveCombat({now:()=>now,auto:false,starterNpcs:false,scene,emit:()=>{}});
 function add(id,extra={}){progress.set(id,{playerId:id,activeCharacterSlot:1,seasonKey:'test',inventory:[],updatedAt:'0',...extra});gold.set(id,100000);}
 async function join(id,card=false,extra={}){const promise=engine.join({sc,zone,monster,actorId:id,actorName:id,stats:{...stats,...extra},monsterStats:monster.calc,options:{playerName:id,playerLevel:65,equipped:card?{special_1:{monsterCardSkill:{key:'hutao_riichi'}}}:{}}});promise.catch(()=>{});await engine.queues.get(zone);return {promise,actor:engine.players.get(id)};}
 return {sc,engine,scene,add,join,progress,gold,operations,state:()=>state,time:n=>now=n,now:()=>now,setState:s=>state=structuredClone(s),fail:v=>fail=v,failProgress:v=>failProgress=v,writes:()=>writeCount,close:()=>{const r=engine.zones.get(zone);if(r&&!r.closed)engine.failRoom(r,Error('fixture completed'));}};
}
async function check(name,fn){try{await fn();checks.push({name,passed:true});console.log('PASS',name);}catch(e){checks.push({name,passed:false,error:e.stack});console.error('FAIL',name,e.stack);}}
const boss=require('../src/services/realtime/hutaoBossRiichi');
(async()=>{Math.random=()=>.49;
await check('three exact probability ranges and 15s shared cadence, no join/restart replay',()=>{
 for(const [roll,expected] of [[0,'tsumo'],[.499999,'tsumo'],[.5,'strike'],[.749999,'strike'],[.75,'deal-in'],[.99999,'deal-in']]){
  const state={normalLive:{actors:{a:{active:true,hp:100}}}};boss.initialize(state,1000);
  assert.equal(boss.claim(state,15999,true,false,()=>roll),null);
  assert.equal(boss.claim(state,16000,true,false,()=>roll).outcome,expected);
  assert.equal(boss.claim(state,16000,true,false,()=>roll),null);
  const recovered=structuredClone(state);boss.initialize(recovered,20000);
  assert.equal(recovered.normalLive.hutaoBossRiichi.nextAt,31000);
  assert.equal(boss.claim(recovered,31000,true,false,()=>roll).outcome,expected);
 }
});
await check('stun/freeze cancels scheduled cast; missed slots never burst on recovery',()=>{
 const s={normalLive:{actors:{}}};boss.initialize(s,0);
 assert.equal(boss.claim(s,15000,true,true),null);
 assert.equal(boss.claim(s,15100,true,false),null);
 assert.equal(boss.claim(s,65000,true,false,()=>.6).outcome,'strike');
 assert.equal(s.normalLive.hutaoBossRiichi.nextAt,75000);
 assert.equal(boss.claim(s,65001,true,false),null);
});
await check('AGI-30 refreshes without stacking, expires at15s, affects attack interval once',()=>{
 const s={normalLive:{actors:{a:{active:true,hp:100},dead:{active:false,hp:0}}}};boss.initialize(s,0);boss.claim(s,15000,true,false,()=>0);
 const base={...stats,agi:80,dodge:60,combo:50},a={actorId:'a',stats:base,tick:500,attackAt:16000};
 const slowed=boss.playerStats(base,s.normalLive.actors.a,15000);assert.equal(slowed.agi,50);assert.equal(slowed.dodge,45);assert.equal(slowed.combo,35);
 assert.equal(s.normalLive.actors.dead.hutaoSlowUntil,undefined);
 assert.equal(boss.playerStats(base,s.normalLive.actors.a,30000).agi,80);
 const room={members:new Map([['a',a]])};boss.applyTicks(room,s,15000);const attack=a.attackAt;boss.applyTicks(room,s,15000);assert.equal(a.attackAt,attack);
 assert.equal(boss.playerStats({...base,agi:10},s.normalLive.actors.a,15000).agi,0);
});
await check('deal-in only adds50crit points, no ATK/final damage bonus; expires exactly15s',()=>{
 const s={normalLive:{actors:{}}};boss.initialize(s,0);boss.claim(s,15000,true,false,()=>.75);
 const m={atk:255,critRate:10,finalDamageMultiplier:1.25};
 assert.deepEqual(boss.monsterStats(m,s,29999),{...m,critRate:60});
 assert.deepEqual(boss.monsterStats(m,s,30000),m);
});
await check('actual core heavy attack is one300% hit, next action returns normal',()=>{
 const session={},p={...stats,agi:1},m={...stats,atk:100,agi:90,hit:100,critRate:0,comboChance:100,maxHp:1000000};
 const options={actionSession:session,liveNormalCombat:true,allowCoopRevive:true,skipPlayerAttack:true,startPlayerHp:10000,startMonsterHp:1000000,playerName:'A',playerLevel:65,equipped:{},monsterIsBoss:true};
 const r=runCombatLoop(p,m,'胡桃',1000000,15,{...options,hutaoBossStrike:true});
 assert.equal(r.damageTaken,300,JSON.stringify(r.roundLogs));assert.equal(r.roundLogs.filter(l=>l.includes('立直重擊')).length,1);
 const next=runCombatLoop(p,{...m,comboChance:0},'胡桃',1000000,15,{...options,startPlayerHp:r.finalPlayerHp,hutaoBossStrike:false,liveMonsterStats:{...m,comboChance:0}});
 assert.equal(next.damageTaken,100,JSON.stringify(next.roundLogs));
 const controlled=runCombatLoop(p,m,'胡桃',1000000,15,{...options,actionSession:{},hutaoBossStrike:true,liveControlActive:true});assert.equal(controlled.damageTaken,0);
});
await check('real shared room rolls once for all alive players and publishes after CAS',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A',false,{agi:80});await f.join('B',false,{agi:80});
 const room=f.engine.zones.get(zone);room.enemyAt=16000;f.time(16000);Math.random=()=>.49;await f.engine.advance(zone);
 const s=f.state();assert.equal(s.normalLive.actors.A.hutaoSlowUntil,31000);assert.equal(s.normalLive.actors.B.hutaoSlowUntil,31000);
 const casts=f.scene.publicSnapshot(f.scene.scenes.get(zone)).events.filter(e=>e.fx==='boss-riichi-tsumo');assert.equal(casts.length,1);
 const next=s.normalLive.hutaoBossRiichi.nextAt;f.add('C');await f.join('C');assert.equal(f.state().normalLive.hutaoBossRiichi.nextAt,next);assert.equal(f.state().normalLive.actors.C.hutaoSlowUntil,undefined);f.close();
});
await check('shared heavy attack reaches each living actor exactly once',async()=>{
 const f=fixture();f.add('A');f.add('B');await f.join('A');await f.join('B');const room=f.engine.zones.get(zone);room.enemyAt=16000;f.time(16000);Math.random=()=>.6;
 await f.engine.advance(zone);assert.equal(f.state().normalLive.actors.A.hp,9910);assert.equal(f.state().normalLive.actors.B.hp,9910);
 assert.equal(f.state().damageMap.A.taken,90);assert.equal(f.state().damageMap.B.taken,90);
 assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).events.filter(e=>e.fx==='boss-riichi-strike').length,1);f.close();Math.random=()=>.49;
});
await check('crit buff reaches actual combat calculation without doubling base damage',()=>{
 const s={normalLive:{actors:{}}};boss.initialize(s,0);boss.claim(s,15000,true,false,()=>.8);
 const m={...stats,atk:100,agi:90,critRate:0,comboChance:0,maxHp:1000000};
 const r=runCombatLoop(stats,boss.monsterStats(m,s,15000),'胡桃',1000000,15,{actionSession:{},liveNormalCombat:true,skipPlayerAttack:true,startPlayerHp:10000,startMonsterHp:1000000,playerName:'A',playerLevel:65,equipped:{},monsterIsBoss:true});
 assert.equal(r.damageTaken,150,JSON.stringify(r.roundLogs));
});
await check('failed room CAS does not publish cast, slow or crit buffs',async()=>{
 const f=fixture();f.add('A');await f.join('A');const room=f.engine.zones.get(zone);room.enemyAt=16000;f.time(16000);f.fail(true);await f.engine.advance(zone);
 assert.equal(f.state().normalLive.hutaoBossRiichi.nextAt,16000);assert.equal(f.state().normalLive.actors.A.hutaoSlowUntil,undefined);
 assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).events.filter(e=>e.fx.startsWith('boss-riichi-')).length,0);
});
Math.random=oldRandom;const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(output)fs.writeFileSync(output,JSON.stringify({productionWrites:false,checks},null,2));if(checks.some(c=>!c.passed))process.exitCode=1;
})().catch(e=>{Math.random=oldRandom;console.error(e);process.exitCode=1;});
