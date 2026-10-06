"use strict";
const fs=require('fs'),crypto=require('crypto');
const {loadBson,buildPlayer}=require('./verify-normal-progression');
const {MonsterService}=require('../src/services/monster/monsterService');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {buildBattleOptions}=require('./lib/jobBattleOptions');
const {NormalLiveCombat}=require('../src/services/realtime/normalLiveCombat');
const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
const {ensureStarterRoom}=require('../src/services/realtime/starterCompanionRooms');
const {ZONES,buildCompanion}=require('../src/services/realtime/starterCompanions');
const {normalExpPerPlayerPct}=require('../src/services/monster/normalCoopScaling');
const snapshot=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11),out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
if(!snapshot||!out)throw Error('--snapshot and --out required');
const runs=Number(process.env.RUNS)||10,items=loadBson(snapshot+'/items.bson'),monsters=loadBson(snapshot+'/monsters.bson'),rows=[];
const jobs=(process.env.JOBS||'swordsman,mage,archer').split(','),humanCounts=(process.env.HUMANS||'1,2,3').split(',').map(Number);
const monsterIds=(process.env.MONSTER_IDS||'').split(',').filter(Boolean),testedMonsters=[];
const sourceFiles=['src/services/realtime/starterCompanions.js','src/services/realtime/starterCompanionCombat.js','src/services/realtime/normalLiveCombat.js','src/services/realtime/monsterActionClock.js','src/shared/combatLoop.js','src/shared/combatStats.js'];
const hashSources=()=>Object.fromEntries(sourceFiles.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const sourceHashes=hashSources();
const service=new MonsterService({findAll:async()=>monsters},null);
const kill=require('../src/services/battle/monsterKillSettlement'),original=kill.handleMonsterKill,random=Math.random;
kill.handleMonsterKill=async()=>[];
let seed=Number(process.env.SEED)||62603117,battles=0;const initialSeed=seed;
Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
async function battle(monster,zone,job,count,group){
  const config=ZONES[zone],build=buildPlayer(items,config.level,config.tier,job),stats=calcPlayerStats(build.attrs,build.equipped,[],[],{zone});
  let now=1000,state={activeMonsterSeq:monster.seq,normalLiveSpawnAt:1000,currentHp:monster.calc.maxHp*group,encounterCount:group,encounterMonsterSeq:monster.seq,damageMap:{},participants:[]};
  const sc={itemService:{listItems:async()=>items},monsterService:{listMonsters:async()=>[monster,...monsters.filter(m=>m.zone===zone&&m.seq!==monster.seq)],getState:async()=>structuredClone(state),saveStateIfActiveMonster:async(next,z,seq,hp)=>{if(state.currentHp!==hp)return false;state=structuredClone(next);return true;}}};
  const engine=new NormalLiveCombat({now:()=>now,auto:false,scene:new ZoneCombatScene({now:()=>now,emit:()=>{}}),emit:()=>{}}),pending=[];
  const join=(i)=>{const p=engine.join({sc,zone,monster,actorId:'audit-'+battles+'-'+i,actorName:'驗收'+i,stats,monsterStats:monster.calc,options:{...buildBattleOptions({equipped:build.equipped,pStats:stats}),playerName:'驗收'+i,playerLevel:config.level,equipped:build.equipped,inventory:[],monsterEquipped:monster.equipment||{},monsterElement:monster.element,monsterElementLevel:monster.elementLevel,monsterIsBoss:!!monster.isBoss,encounterCount:group,encounterUnitHp:monster.calc.maxHp}});p.catch(()=>{});pending.push(p);};
  for(let i=0;i<count;i++)join(i);
  if(!count)await ensureStarterRoom(engine,sc,zone);
  await engine.queues.get(zone);let room=engine.zones.get(zone);
  const npcDeaths={};let turns=0,deaths=0;
  while(state.currentHp>0&&++turns<10000){
    for(let i=0;i<count;i++){const id='audit-'+battles+'-'+i;if(!engine.players.has(id)&&engine.recoveryUntil(id)<=now){join(i);await engine.queues.get(zone);room=engine.zones.get(zone);}}
    const humanTimes=[...room.members.values()].filter(a=>!a.done&&a.hp>0).map(a=>a.attackAt);
    const npcTimes=(room.companions||[]).filter(n=>state.normalLive.npcs?.[n.key]?.selected&&state.normalLive.npcs[n.key].hp>0).map(n=>state.normalLive.npcs[n.key].attackAt);
    const recoveryTimes=Array.from({length:count},(_,i)=>'audit-'+battles+'-'+i).filter(id=>!engine.players.has(id)).map(id=>engine.recoveryUntil(id));
    recoveryTimes.push(...Object.values(state.normalLive?.npcs||{}).filter(n=>n.hp<=0&&n.recoverAt>now).map(n=>n.recoverAt));
    now=Math.max(now+1,Math.min(room.closed?Infinity:room.enemyAt,...humanTimes,...(room.closed?[]:npcTimes),...recoveryTimes));
    if(!Number.isFinite(now))throw Error('No next action');
    const before=[...room.members.values()].filter(a=>!a.done).length,npcBefore=structuredClone(state.normalLive?.npcs||{});await engine.advance(zone);deaths+=Math.max(0,before-[...room.members.values()].filter(a=>!a.done||state.currentHp<=0).length);
    for(const[key,n]of Object.entries(state.normalLive?.npcs||{}))if(npcBefore[key]?.hp>0&&n.hp<=0)npcDeaths[key]=(npcDeaths[key]||0)+1;
  }
  if(!room.closed)engine.failRoom(room,Error('simulation limit'));
  await Promise.allSettled(pending);battles++;
  if(state.currentHp>0)throw Error('Encounter not finished after recovery');
  const dead=deaths>0,seconds=(now-1000)/1000+1.5;
  return {seconds,dead,deaths,npcDeaths,npcDamage:Object.values(state.normalLive?.npcs||{}).reduce((s,n)=>s+n.damage,0),exp:Math.round(monster.expReward*group*(group===3?1.2:group===2?1.1:1)*normalExpPerPlayerPct(count)/100),turns};
}
(async()=>{
  for(const zone of Object.keys(ZONES)){
    const mobs=(await service.listMonsters({zone})).filter(m=>m.zone===zone&&!m.allZones&&!m.isBoss&&(!monsterIds.length||monsterIds.includes(m.id)));
    if(!mobs.length)continue;
    testedMonsters.push(...mobs.map(m=>({id:m.id,name:m.name,zone})));
    for(const job of jobs)for(const count of humanCounts){
      let seconds=0,exp=0,deaths=0,weight=0,npcDamage=0;const npcDeathWeight={};
      for(const monster of mobs)for(let run=0;run<runs;run++)for(const group of [1,2,3]){const result=await battle(monster,zone,job,count,group),w=monster.spawnRate||1;seconds+=result.seconds*w;exp+=result.exp*w;deaths+=Number(result.dead)*w;weight+=w;npcDamage+=result.npcDamage*w;for(const key of ZONES[zone].keys)npcDeathWeight[key]=(npcDeathWeight[key]||0)+Number(result.npcDeaths[key]>0)*w;}
      const row={zone,level:ZONES[zone].level,job,humans:count,meanSeconds:+(seconds/weight).toFixed(2),deathPct:+(deaths/weight*100).toFixed(2),npcDeathPct:Object.fromEntries(Object.entries(npcDeathWeight).map(([key,w])=>[key,+(w/weight*100).toFixed(2)])),expPerMinute:Math.round(exp/seconds*60),meanNpcDamage:Math.round(npcDamage/weight)};rows.push(row);console.log(JSON.stringify(row));
    }
  }
  const comparisons=[];
  for(const zone of Object.keys(ZONES))for(const job of jobs){const cases=[1,2,3].map(n=>rows.find(r=>r.zone===zone&&r.job===job&&r.humans===n));if(cases.some(r=>!r))continue;comparisons.push({zone,job,moreHumansFaster:cases[1].expPerMinute>cases[0].expPerMinute&&cases[2].expPerMinute>cases[1].expPerMinute,rates:cases.map(r=>r.expPerMinute)});}
  const sourceDrift=JSON.stringify(sourceHashes)!==JSON.stringify(hashSources());
  const report={at:new Date().toISOString(),seed:initialSeed,runs,battles,snapshot,sourceHashes,sourceDrift,testedMonsters,roster:Object.entries(ZONES).flatMap(([zone,c])=>c.keys.map(k=>buildCompanion(k,zone,items,monsters))),rows,comparisons,scope:'Current ordinary monsters, optionally filtered by MONSTER_IDS; groups 1/2/3; same-level D/C/B gear; production job options and live clock, persistent monster HP and contributions across 30s human death recovery. NPC death percentages mean at least one death per encounter, weighted by spawn rate. Specified builds, not full player journeys.'};
  fs.writeFileSync(out,JSON.stringify(report,null,2));if(sourceDrift||comparisons.some(c=>!c.moreHumansFaster))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{kill.handleMonsterKill=original;Math.random=random;});
