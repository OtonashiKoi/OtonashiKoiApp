'use strict';
// Candidate data only. Calibrate with a training seed; acceptance is a separate run.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadBson}=require('./verify-normal-progression');
const {simulate}=require('./verify-normal-basic-combat');
const {MonsterService}=require('../src/services/monster/monsterService');
const {SETTINGS}=require('./lib/gear-ladder');
const ZONES=['ancient_city','mistwood','ancient_city_deep','dragon_realm','hellfire','metal_mine'];
async function main(){
 const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
 const dir=arg('--snapshot'),out=arg('--output');if(!dir||!out)throw Error('snapshot/output required');
 const items=loadBson(dir+'/items.bson'),raw=loadBson(dir+'/monsters.bson'),plan=[];
 const calc=async m=>(await new MonsterService({findAll:async()=>[m]}).listMonsters())[0];
 for(const m of raw.filter(m=>m.enabled&&ZONES.includes(m.zone)&&!m.isBoss&&!m.allZones&&!m.incomingDamageCap)){
  const t=SETTINGS[m.zone],tier=t.tiers[2];
  const before=simulate(await calc(m),items,t.level,tier,tier,300,20261003);
  let best=m.str,after=before;
  // Raise weak attacks into the existing safe full-gear envelope. No HP/DEF,
  // AGI, rewards, card/skill or boss changes, and no forced death target.
  let lo=m.str+1,hi=Math.ceil(m.str*1.3);
  while(lo<=hi){
   const str=Math.floor((lo+hi)/2),r=simulate(await calc({...m,str}),items,t.level,tier,tier,300,20261003);
   if(r.deathPct<=7&&Object.values(r.byJob).every(j=>j.deathPct<=15&&j.killPct>=85&&j.rounds<=12)){best=str;after=r;lo=str+1;}else hi=str-1;
  }
  if(best===m.str)continue;
  plan.push({id:m.id,name:m.name,zone:m.zone,before:{str:m.str,maxHp:m.maxHp,full:before},values:{str:best,normalPressureRevision:'normal-pressure-20261002-v1'},after});
  console.log(JSON.stringify({name:m.name,zone:m.zone,attackBefore:m.str*3,attackAfter:best*3,hpBefore:before.hpPct,hpAfter:after.hpPct,deathAfter:after.deathPct}));
 }
 const hashes=Object.fromEntries(['monsters.bson','items.bson'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex')]));
 fs.writeFileSync(out,JSON.stringify({revision:'normal-pressure-20261002-v1',target:'meaningful incoming damage and armor upgrades; no fixed death target',seed:20261003,runs:300,snapshotHashes:hashes,productionWrites:false,plan},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
