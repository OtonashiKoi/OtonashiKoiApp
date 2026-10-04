"use strict";
const fs=require('node:fs');
const {loadBson}=require('./verify-normal-progression');
const {simulate}=require('./verify-normal-basic-combat');
const {simulateStarter}=require('./lib/beginner-combat');
const {SETTINGS}=require('./lib/gear-ladder');
const {REVISION,attackFor,profileOf}=require('./lib/basic-monster-gradient');
const {MonsterService}=require('../src/services/monster/monsterService');
async function calc(m){return (await new MonsterService({findAll:async()=>[m]}).listMonsters())[0];}
async function main(){const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);const dir=arg('--snapshot');if(!dir)throw Error('snapshot required');const items=loadBson(dir+'/items.bson'),monsters=loadBson(dir+'/monsters.bson'),plan=[];
for(const source of monsters.filter(m=>m.enabled&&SETTINGS[m.zone]&&!m.isBoss&&!m.allZones&&!m.incomingDamageCap)){
 const t=SETTINGS[source.zone],tier=t.tiers[2],m={...source,str:attackFor(source)},before=source.zone==='beginner'?await simulateStarter(await calc(source),items,1,30):simulate(await calc(source),items,t.level,tier,tier,30);
 let full=before;
 // Largest HP that full +0 equipment can clear safely in about ten rounds per weapon route.
 // Exact battle loop includes level suppression, hit/crit/combo/block/AGI rules.
 if(source.zone!=='beginner'){
  let lo=Math.max(1,Math.round(source.maxHp*0.1)),hi=Math.round(source.maxHp*1.1);
  for(let n=0;n<10;n++){const hp=Math.floor((lo+hi)/2);const r=simulate(await calc({...m,maxHp:hp}),items,t.level,tier,tier,20);
   if(Object.values(r.byJob).every(j=>j.deathPct<=8&&j.killPct>=90&&j.rounds<=10))lo=hp+1;else hi=hp-1;
  }
  m.maxHp=Math.max(1,hi);
  for(let n=0;n<8;n++){full=simulate(await calc(m),items,t.level,tier,tier,100);if(Object.values(full.byJob).every(j=>j.deathPct<=12&&j.killPct>=85&&j.rounds<=10.5))break;m.maxHp=Math.round(m.maxHp*0.94);}
 }else full=await simulateStarter(await calc(m),items,1,100);
 const armorLow=simulate(await calc(m),items,t.level,t.tiers[1],tier,100);
 const weaponLow=simulate(await calc(m),items,t.level,tier,t.tiers[1],100);
 const insufficient=simulate(await calc(m),items,t.level,t.tiers[0],t.tiers[0],100);
 // Keep ordinary EXP/time close to before, rather than inflate rewards by
 // shortening encounters. Area penalty is applied later per participant.
 const expReward=source.zone==='beginner'||source.zone==='normal'?source.expReward:Math.max(1,Math.round(source.expReward*full.rounds/before.rounds));
 const values={str:m.str,maxHp:m.maxHp??source.maxHp,expReward,basicGradientRevision:REVISION,basicGradientProfile:profileOf(m.name)};
 const row={id:source.id,name:source.name,zone:source.zone,before:{str:source.str,hp:source.maxHp,exp:source.expReward,full:before},values,full,armorLow,weaponLow,insufficient};plan.push(row);
 console.log(JSON.stringify({name:m.name,atk:m.str*3,hp:values.maxHp,death:+full.deathPct.toFixed(1),armorLowDeath:+armorLow.deathPct.toFixed(1),rounds:+full.rounds.toFixed(1)}));
}
fs.writeFileSync(arg('--output')||dir+'/basic-plan.json',JSON.stringify({revision:REVISION,plan},null,2));}
main().catch(e=>{console.error(e);process.exitCode=1});
