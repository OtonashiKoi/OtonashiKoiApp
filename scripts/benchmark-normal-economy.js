'use strict';
// Read-only, repeatable benchmark. Every equipment loadout owns its stats;
// enhancement may never mutate the shared BSON item library.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadBson}=require('./verify-normal-progression');
const {basicPlayer}=require('./verify-normal-basic-combat');
const {MonsterService}=require('../src/services/monster/monsterService');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {runCombatLoop}=require('../src/shared/combatLoop');
const {calculateBattleTickMs,calculateWebBattleCooldownMs}=require('../src/shared/battleTiming');
const {EnhanceService}=require('../src/services/enhance/enhanceService');
const rewards=require('../src/services/battle/battleRewardRules');
const {normalZoneExpMultiplier}=require('../src/shared/normalZoneExp');
const {expToNextLevel}=require('../src/shared/progression');
const {ZONE_BY_KEY}=require('../src/shared/zones');
const JOBS=['swordsman','mage','archer'];
function route(level){return level<=3?'beginner':level<=9?'normal':level<=19?'mid':level<=29?'ancient_city':level<=39?'mistwood':'ancient_city_deep';}
function tier(level){return level<=3?'none':level<=9?'D':level<=19?'C':level<=39?'B':'A';}
async function benchmark(snapshot,seedValue=20260930,runs=50,plan=null){
 const items=loadBson(snapshot+'/items.bson'),raw=loadBson(snapshot+'/monsters.bson');
 const originalHash=crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
 const changes=new Map((plan?.monsters||[]).map(r=>[r.id,r.values]));
 const monsters=await new MonsterService({findAll:async()=>raw.map(m=>({...m,...changes.get(m.id)}))}).listMonsters({includeDisabled:false});
 const cases=[];for(let lv=1;lv<=49;lv++)cases.push([route(lv),lv]);
 for(const zone of ['beginner','normal','mid','ancient_city','mistwood','ancient_city_deep','dragon_realm','hellfire','metal_mine']){
 const lv={beginner:1,normal:5,mid:15,ancient_city:25,mistwood:35}[zone]||45;
 if(!cases.some(([z,l])=>z===zone&&l===lv))cases.push([zone,lv]);
 }
 const rows=[],details=[];let state=seedValue,battles=0;const random=Math.random;
 Math.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 try{for(const [zone,level]of cases)for(const job of JOBS){
 const p=basicPlayer(structuredClone(items),level,tier(level),tier(level),job),en=new EnhanceService();
 for(const e of Object.values(p.equipped)){for(let i=0;i<3;i++)en._applyEnhanceStats(e,e.tier);e.enhanceLevel=3;}
 const stats=calcPlayerStats(p.attrs,p.equipped,[],[],{zone}),mod=rewards.buildRewardModifiers({equipment:p.equipped});
 let seconds=0,gold=0,exp=0,weight=0,deaths=0,bouts=0,fees=0;
 for(const m of monsters.filter(m=>m.zone===zone&&!m.isBoss&&!m.allZones&&!m.incomingDamageCap)){
 const w=Math.max(0,Number(m.spawnRate)||0);if(!w)continue;let sec=0,dead=0,count=0;
 for(let n=0;n<runs;n++){let hp=m.calc.maxHp,attempt=0;
 while(hp>0&&attempt++<100){const result=runCombatLoop(structuredClone(stats),{...m.calc},m.name,hp,15,{playerLevel:level,equipped:p.equipped,inventory:[],monsterEquipped:{},zone,monsterIsBoss:false});
 battles++;hp=result.finalMonsterHp;const lost=result.outcome==='lose';
 // Win/lose returns its terminal round; only a continued bout returns next round.
 const roundCount=Math.min(15,Math.max(1,result.outcome==='continue'?result.nextRound-1:result.nextRound));
 sec+=calculateWebBattleCooldownMs({roundCount,perRoundMs:calculateBattleTickMs(stats.agi),lost})/1000+(hp<=0?.42:0);dead+=Number(lost);count++;fees+=Math.max(0,m.entryFee??ZONE_BY_KEY[zone].defaultEntryFee??0)*w;}
 assert.ok(hp<=0,`${job} Lv${level} ${m.name} unkillable`);
 gold+=Math.round(Math.max(m.goldReward||0,rewards.getDynamicGoldPoolFloor(zone,1))*mod.goldMultiplier)*w;
 exp+=Math.round(m.expReward*mod.expMultiplier*normalZoneExpMultiplier(zone,level))*w;weight+=w;}
 seconds+=sec*w;deaths+=dead*w;bouts+=count*w;
 details.push({zone,level,job,id:m.id,name:m.name,weight:w,gold:m.goldReward,exp:m.expReward,secondsPerKill:sec/runs,goldMultiplier:mod.goldMultiplier,expMultiplier:mod.expMultiplier,deathPct:dead/count*100});
 }
 rows.push({zone,level,tier:tier(level),job,secondsPerKill:seconds/weight,killsPerHour:weight/seconds*3600,goldPerHour:gold/seconds*3600,netGoldPerHour:(gold-fees)/seconds*3600,expPerHour:exp/seconds*3600,deathPct:deaths/bouts*100,goldMultiplier:mod.goldMultiplier,expMultiplier:mod.expMultiplier});
 }
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex'),originalHash,'item library mutated during calibration');
 const stages=[[1,10],[10,20],[20,30],[30,40],[40,50]],hours=JOBS.map(job=>({job,stages:stages.map(([from,to])=>({from,to,hours:rows.filter(r=>r.job===job&&r.level>=from&&r.level<to&&r.zone===route(r.level)).reduce((s,r)=>s+expToNextLevel(r.level)/r.expPerHour,0)}))}));
 return{generatedAt:new Date().toISOString(),seed:seedValue,runs,battles,productionWrites:false,itemLibraryUnchanged:true,rows,details,hours,assumptions:['solo, isolated current +3 gear, no cards/skills/auras/pets/bestiary/element stones','attributes 1 random + 1 chosen per level, averaged allocation 55% primary/30% VIT/15% AGI','fresh HP at each 15-round bout; monster HP carries; death30s; handoff500ms and death420ms','all required gear pre-equipped; acquisition, sorting, network and real continuous HP excluded'],hashes:Object.fromEntries(['src/shared/progression.js','src/shared/combatLoop.js','src/shared/combatStats.js','scripts/benchmark-normal-economy.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(require('path').join(__dirname,'..',f))).digest('hex')]))};
 }finally{Math.random=random;}
}
async function main(){const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);assert.ok(arg('--snapshot')&&arg('--output'));const report=await benchmark(arg('--snapshot'),Number(arg('--seed')||20260930),Number(arg('--runs')||50),arg('--plan')?JSON.parse(fs.readFileSync(arg('--plan'))):null);fs.writeFileSync(arg('--output'),JSON.stringify(report,null,2));console.log(JSON.stringify({battles:report.battles,hours:report.hours,reference:report.rows.filter(r=>r.level===({beginner:1,normal:5,mid:15,ancient_city:25,mistwood:35}[r.zone]||45))}));}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1});
module.exports={benchmark,route,JOBS};
