'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runCombatLoop}=require('../src/shared/combatLoop');
const {loadBson}=require('./verify-normal-progression');
async function main(){
 const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
 const root=arg('--fixtures'),snap=arg('--snapshot'),out=arg('--output'),planFile=arg('--plan');
 if(!root||!snap||!out)throw Error('fixtures/snapshot/output required');
 const raw=loadBson(snap+'/monsters.bson'),changes=planFile?new Map(JSON.parse(fs.readFileSync(planFile)).plan.map(x=>[x.id,x.values])):new Map();
 const {MonsterService}=require('../src/services/monster/monsterService');
 const monsters=await new MonsterService({findAll:async()=>raw.map(m=>({...m,...changes.get(m.id)}))}).listMonsters();
 const byId=new Map(monsters.map(m=>[m.id,m]));
 const fixtureFiles=fs.readdirSync(root).filter(n=>n.startsWith('probe-')&&fs.statSync(path.join(root,n)).isDirectory()).flatMap(n=>fs.readdirSync(path.join(root,n)).filter(f=>f.endsWith('.fixtures.jsonl')).map(f=>path.join(root,n,f)));
 const runs=Number(arg('--runs')||100),seed=Number(arg('--seed')||937451),groups={},failures=[];
 const random=Math.random;let state=seed;
 Math.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 let battles=0;
 try {for(const file of fixtureFiles){
  const points=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for(const f of points){
   if(f.level>=50||!['ancient_city','mistwood','ancient_city_deep'].includes(f.zone))continue;
   const m=byId.get(f.monster.id);if(!m||m.isBoss||m.allZones||m.incomingDamageCap)continue;
   const key=f.route.baseKey+':'+f.zone,g=groups[key]||={job:f.route.baseKey,zone:f.zone,fixtures:0,battles:0,deaths:0,hp:0,taken:0,noDamage:0,rounds:0};g.fixtures++;
   for(let n=0;n<runs;n++){
    // Same acquired equipment/skills/HP fraction, sampled with independent RNG.
    const hp=f.hp/f.monster.calc.maxHp*m.calc.maxHp;
    const r=runCombatLoop(structuredClone(f.stats),{...m.calc},m.name,hp,15,structuredClone(f.options));
    g.battles++;battles++;g.deaths+=r.outcome==='lose';g.hp+=Math.max(0,r.finalPlayerHp)/f.stats.maxHp;
    g.taken+=r.damageTaken/f.stats.maxHp;g.noDamage+=r.damageTaken===0;
    g.rounds+=Math.min(15,r.outcome==='continue'?r.nextRound-1:r.nextRound);
   }
  }
 }}finally{Math.random=random;}
 const rows=Object.values(groups).map(g=>({job:g.job,zone:g.zone,fixtures:g.fixtures,battles:g.battles,deathPct:100*g.deaths/g.battles,hpRemainingPct:100*g.hp/g.battles,damageTakenPct:100*g.taken/g.battles,noDamagePct:100*g.noDamage/g.battles,rounds:g.rounds/g.battles}));
 const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 const report={mode:'replay of actual acquired growth states; not a new full growth acceptance',productionWrites:false,seed,runs,battles,rows,failures,fixtureHashes:Object.fromEntries(fixtureFiles.map(f=>[f,digest(f)])),snapshotHashes:{monsters:digest(snap+'/monsters.bson'),items:digest(snap+'/items.bson')},planHash:planFile?digest(planFile):null,sourceHashes:Object.fromEntries(['src/shared/combatLoop.js','src/shared/combatStats.js','scripts/verify-normal-pressure.js'].map(f=>[f,digest(path.join(__dirname,'..',f))]))};
 fs.writeFileSync(out,JSON.stringify(report,null,2));
 for(const zone of ['ancient_city','mistwood','ancient_city_deep']){const a=rows.filter(r=>r.zone===zone);console.log(JSON.stringify({zone,jobs:a.length,...Object.fromEntries(['deathPct','hpRemainingPct','damageTakenPct','noDamagePct','rounds'].map(k=>[k,a.reduce((s,r)=>s+r[k],0)/a.length]))}));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
