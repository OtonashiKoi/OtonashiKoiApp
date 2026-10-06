"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs');
const {loadBson}=require('./verify-normal-progression');
const {NormalLiveCombat}=require('../src/services/realtime/normalLiveCombat');
const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
const {ZONES,buildCompanion}=require('../src/services/realtime/starterCompanions');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {calculateBattleTickMs}=require('../src/shared/battleTiming');
const {normalExpPerPlayerPct}=require('../src/services/monster/normalCoopScaling');
const snapshot=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11);
if(!snapshot)throw Error('--snapshot required');
const items=loadBson(snapshot+'/items.bson'),monsters=loadBson(snapshot+'/monsters.bson'),checks=[];
const kill=require('../src/services/battle/monsterKillSettlement'),originalKill=kill.handleMonsterKill,oldRandom=Math.random;
Math.random=()=>0.5;
kill.handleMonsterKill=async({state})=>{const lines=[];lines._perPidRewards=Object.fromEntries(Object.entries(state.damageMap).filter(([,v])=>v.damage>0||v.assist>0).map(([id])=>[id,{gold:10,exp:normalExpPerPlayerPct(Object.keys(state.damageMap).length),drops:[]}]));return lines;};
function fixture(zone='normal',hp=100000,monsterAtk=1){
  let now=1000,fail=false,state={activeMonsterSeq:1,normalLiveSpawnAt:1000,currentHp:hp,encounterCount:1,encounterMonsterSeq:1,damageMap:{},participants:[]};
  const monster={seq:1,id:'starter-test',name:'陪練驗收怪',zone,level:ZONES[zone]?.level||30,calc:{atk:monsterAtk,agi:1,hit:100,dodge:0,crit:0,flatDef:0,def:0,maxHp:hp,dmgMin:1,dmgMax:1}};
  const sc={itemService:{listItems:async()=>items},monsterService:{getState:async()=>structuredClone(state),saveStateIfActiveMonster:async(next,z,seq,expected)=>{if(fail||state.currentHp!==expected)return false;state=structuredClone(next);return true;}}};
  const scene=new ZoneCombatScene({now:()=>now,emit:()=>{}}),engine=new NormalLiveCombat({now:()=>now,scene,auto:false,emit:()=>{}}),pending=[];
  const join=(id,options={},stats={})=>{const p=engine.join({sc,zone,monster,actorId:id,actorName:id,stats:{atk:10,maxHp:100000,agi:1,dex:10,hit:100,crit:0,dodge:0,flatDef:0,def:0,dmgMin:1,dmgMax:1,...stats},monsterStats:monster.calc,options:{playerName:id,playerLevel:monster.level,equipped:{},inventory:[],...options}});p.catch(()=>{});pending.push(p);return p;};
  return {engine,scene,join,pending,state:()=>state,time:t=>{now=t;},fail:()=>{fail=true;},stop:async()=>{engine.failRoom(engine.zones.get(zone),Error('end fixture'));await Promise.allSettled(pending);}};
}
async function check(name,work){try{await work();checks.push({name,ok:true});console.log('PASS',name);}catch(e){checks.push({name,ok:false,error:e.stack});console.error('FAIL',name,e.message);}}
const hold=setInterval(()=>{},1000);
(async()=>{
await check('all 8 NPCs use exact level point budgets, current D/C/B equipment and production stats',async()=>{
  for(const[zone,c]of Object.entries(ZONES))for(const key of c.keys){const n=buildCompanion(key,zone,items,monsters);assert.equal(Object.values(n.attributes).reduce((a,b)=>a+b),6+2*(c.level-1));assert.ok(Object.values(n.attributes).every(Number.isInteger));assert.deepEqual(n.stats,calcPlayerStats(n.attributes,n.equipped,[],[],{zone}));assert.ok(Object.entries(n.equipped).every(([slot,i])=>(slot==='job_eq'||i.tier===c.tier)&&!i.enhanceLevel&&!i.monsterCardSkill));assert.equal(n.tick,calculateBattleTickMs(n.stats.agi));
    const drops=new Set(monsters.filter(m=>m.zone===zone&&m.enabled&&!m.allZones).flatMap(m=>(m.drops||[]).filter(d=>d.chance>0).map(d=>d.itemId)));
    for(const slot of ['weapon','armor','garment','shoes','head_top','head_mid','head_low','accessory_l','accessory_r'])assert.ok(n.equipped[slot],key+' missing '+slot);
    for(const[slot,item]of Object.entries(n.equipped)){if(slot!=='job_eq')assert.ok(drops.has(item.itemId),key+' out-of-map '+item.itemName);const actual=items.find(i=>i.id===item.itemId);assert.deepEqual(item.passiveEffects,actual.passiveEffects);assert.deepEqual(item.jobSkills,actual.jobSkills);}
    assert.equal(n.equipped.job_eq?.itemId,c.level>=10?require('../src/shared/jobAdvancement').BASE_JOBS[key.replace('-','_')].badgeId:undefined);
    assert.equal(!!n.equipped.shield,!['bow','staff_2h'].includes(n.stats.weaponType));
  }
});
await check('all 4 zones fill 1/2/3 active humans with 2/1/0 NPCs; HP and prior damage never reset',async()=>{
  for(const zone of Object.keys(ZONES)){const f=fixture(zone);f.join('A');await f.engine.queues.get(zone);assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).actors.filter(a=>a.isNpc).length,2);
    f.time(1300);await f.engine.advance(zone);const hp=f.state().currentHp,credit=structuredClone(f.state().damageMap);
    f.join('B');await f.engine.queues.get(zone);assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).actors.filter(a=>a.isNpc).length,1);
    f.join('C');await f.engine.queues.get(zone);assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).actors.filter(a=>a.isNpc).length,0);assert.equal(f.state().currentHp,hp);assert.deepEqual(f.state().damageMap,credit);
    await f.engine.leave('C',f.engine.players.get('C').id);assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).actors.filter(a=>a.isNpc).length,1);
    await f.engine.leave('B',f.engine.players.get('B').id);assert.equal(f.scene.publicSnapshot(f.scene.scenes.get(zone)).actors.filter(a=>a.isNpc).length,2);
    await f.engine.leave('A',f.engine.players.get('A').id);const idle=f.state().currentHp;f.time(20000);await f.engine.advance(zone);f.time(20001);await f.engine.advance(zone);assert.ok(f.state().currentHp<idle);assert.equal(f.engine.actorSnapshot(zone).filter(a=>a.isNpc).length,2);assert.equal(f.engine.zones.get(zone).closed,false);await f.stop();}
});
await check('mistwood and every later normal zone do not spawn starter helpers',async()=>{
  for(const zone of ['mistwood','ancient_city_deep','metal_mine','dragon_realm','hellfire']){const f=fixture(zone);f.join('A');await f.engine.queues.get(zone);assert.equal(f.engine.actorSnapshot(zone).filter(a=>a.isNpc).length,0);await f.stop();}
});
await check('2 humans with healing or protection receive output; otherwise receive support',async()=>{
  for(const protect of [false,true]){const f=fixture();f.join('A',protect?{partyEffects:[{key:'party_heal',sourceDiscordId:'A',params:{value:2},isSelfAura:true}]}:{});f.join('B');await f.engine.queues.get('normal');assert.equal(f.engine.actorSnapshot('normal').find(a=>a.isNpc).role,protect?'output':'support');await f.stop();}
});
await check('NPCs attack immediately at their own cadence without waiting for human contribution, with separate durable damage',async()=>{
  const f=fixture('normal',100000);f.join('A');await f.engine.queues.get('normal');f.engine.players.get('A').attackAt=100000;
  f.time(20000);await f.engine.advance('normal');f.time(20001);await f.engine.advance('normal');assert.ok(f.state().currentHp<100000,'helpers attack without human contribution');assert.ok(Object.values(f.state().damageMap).every(v=>!(v.damage>0||v.assist>0)));
  f.engine.players.get('A').attackAt=20002;f.time(20002);await f.engine.advance('normal');assert.ok(Object.values(f.state().normalLive.npcs).some(n=>n.damage>0));assert.deepEqual(Object.keys(f.state().damageMap),['A']);assert.deepEqual(f.state().participants,['A']);assert.deepEqual(Object.keys(f.state().normalLive.actors),['A']);assert.ok(f.scene.publicSnapshot(f.scene.scenes.get('normal')).events.some(e=>e.actorId.startsWith('starter-npc:')&&e.damage>0));assert.equal(normalExpPerPlayerPct(Object.keys(f.state().damageMap).length),100);
  await f.stop();
});
await check('NPC final hit settles only real qualified humans once',async()=>{
  const f=fixture('beginner',300);const a=f.join('A');await f.engine.queues.get('beginner');f.time(1300);await f.engine.advance('beginner');f.engine.players.get('A').attackAt=999999;
  f.time(4750);await f.engine.advance('beginner');f.time(4751);await f.engine.advance('beginner');const result=await a;assert.equal(result.outcome,'win');assert.equal(result.liveRewards._summary.exp,100);assert.equal(f.state().currentHp,0);assert.deepEqual(Object.keys(f.state().damageMap),['A']);assert.ok(f.state().normalLive.npcs.swordsman.damage>0);await f.stop();
});
await check('NPC healing is effective at its calculated strength without earning assist or job EXP',async()=>{
  const f=fixture('beginner',100000,50);f.join('A');await f.engine.queues.get('beginner');f.time(1300);await f.engine.advance('beginner');f.time(2500);await f.engine.advance('beginner');const hp=f.engine.players.get('A').hp;
  f.time(2800);await f.engine.advance('beginner');assert.equal(f.engine.players.get('A').hp,hp+f.engine.zones.get('beginner').companions.find(n=>n.key==='healer').skill.value);assert.deepEqual(Object.keys(f.state().damageMap),['A']);assert.equal(f.state().damageMap.A.assist||0,0);await f.stop();
});
await check('NPC death rests for 30s; human joins cannot heal or reset its cooldown',async()=>{
  const f=fixture('normal',100000,1000);f.join('A');await f.engine.queues.get('normal');f.time(1300);await f.engine.advance('normal');f.time(2500);await f.engine.advance('normal');assert.equal(f.state().normalLive.npcs.archer.hp,0);const recover=f.state().normalLive.npcs.archer.recoverAt;
  f.join('B');f.join('C');await f.engine.queues.get('normal');await f.engine.leave('C',f.engine.players.get('C').id);await f.engine.leave('B',f.engine.players.get('B').id);assert.equal(f.state().normalLive.npcs.archer.hp,0);assert.equal(f.state().normalLive.npcs.archer.recoverAt,recover);
  f.time(recover-1);await f.engine.advance('normal');assert.equal(f.state().normalLive.npcs.archer.hp,0);f.time(recover);await f.engine.advance('normal');assert.ok(f.state().normalLive.npcs.archer.attackAt>=recover);await f.stop();
});
await check('failed shared CAS publishes no NPC damage and stops room; existing monster state retained',async()=>{
  const f=fixture();f.join('A');await f.engine.queues.get('normal');f.time(1300);await f.engine.advance('normal');const before=structuredClone(f.state());f.fail();f.time(15000);await f.engine.advance('normal');assert.deepEqual(f.state(),before);assert.equal(f.engine.zones.get('normal').closed,true);await f.stop();
});
})().finally(()=>{clearInterval(hold);kill.handleMonsterKill=originalKill;Math.random=oldRandom;const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);if(out)fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),checks},null,2));if(checks.some(c=>!c.ok))process.exitCode=1;});
