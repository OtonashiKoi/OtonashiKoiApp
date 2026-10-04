"use strict";
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
require('dotenv').config({quiet:true});
const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
const {createServiceContext}=require('../src/services/createServiceContext');
const {runCombatLoop}=require('../src/shared/combatLoop');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {buildEventBossContent}=require('./lib/event-boss-content');
const {getWorldBossPartKeys,applyWorldBossTargetToPlayerStats,applyWorldBossTargetToMonster}=require('../src/services/battle/bossMechanics');
function loadCharacters(base){
 const out=[],seen=new Set();
 for(const dir of ['full-100-1','full-100-2','full-100-3','full-100-4']) {
  for(const file of fs.readdirSync(path.join(base,dir)).filter(f=>f.endsWith('.summary.json')).sort()){
   const source=path.join(base,dir,file), summary=JSON.parse(fs.readFileSync(source));
   if(!summary.complete||summary.level!==50||seen.has(summary.route.t2Badge))continue;
   const fixture=source.replace('.summary.json','.fixtures.jsonl');if(!fs.existsSync(fixture))continue;
   const rows=fs.readFileSync(fixture,'utf8').trim().split('\n'),last=JSON.parse(rows.at(-1));
   const equipment=last.options.equipped;
   for(const [slot,g]of Object.entries(summary.gear)){
    const entry=equipment[slot];assert.equal(entry?.itemId||entry?.id,g.id,`final gear differs ${source}:${slot}`);
    entry.enhanceLevel=g.plus;if(g.jobLevel!=null)entry.jobExp=g.jobLevel;
   }
   out.push({summary,options:last.options,equipment,source,fixture,sha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')});seen.add(summary.route.t2Badge);
  }
 }
 assert.ok(out.length>=10,'need >=10 genuinely completed Lv50 builds');return out;
}
async function main(){
 const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(out);
 const chars=loadCharacters('/Users/riuchen/Documents/game-backups/growth-rerun-20261002-v2');
 const db=await getMongoDb(), sc=createServiceContext(), items=await db.collection('items').find({}).toArray();
 const ht=await db.collection('monsters').findOne({id:'event-northwind-hutao'}),content=buildEventBossContent(items,ht);
 const rabbits=await sc.monsterService.previewMonster?.(content.monster);
 const monsters=[];
 for(const zone of ['event_boss','event_boss_hutao_preview'])monsters.push((await sc.monsterService.listMonsters({zone,includeDisabled:true})).find(m=>m.isBoss));
 // Shared MonsterService constructs the actual effective calc without exposing a formula duplicate.
 const temp=new (require('../src/services/monster/monsterService').MonsterService)({findById:async()=>content.monster},{});
 monsters.push(await temp.getMonsterById(content.monster.id));
 const rows=[];
 let state=937451;const random=Math.random;Math.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 try{for(const boss of monsters)for(const c of chars){
   let damage=0,deaths=0;
   const stats=calcPlayerStats(c.summary.attributes,c.equipment,[],c.options.inventory,{zone:boss.zone});
   const bp=applyWorldBossTargetToPlayerStats(stats,'body',boss.zone).stats;
   const bm=applyWorldBossTargetToMonster(boss.calc,boss.equipment||{},'body',boss.zone);
   for(let n=0;n<20;n++){
    const opts={...structuredClone(c.options),playerLevel:50,zone:boss.zone,equipped:c.equipment,monsterEquipped:bm.monsterEquipped,monsterIsBoss:true,isWorldBoss:true,monsterElement:boss.element,monsterElementLevel:boss.elementLevel};
    const r=runCombatLoop(bp,bm.monsterStats,boss.name,boss.calc.maxHp,15,opts);
    damage+=r.totalDamage;deaths+=r.outcome==='lose';
   }
   rows.push({boss:boss.name,zone:boss.zone,job:c.summary.route.t2Name,seed:c.summary.seed,source:c.source,sourceHash:c.sha256,level:50,hp:stats.maxHp,atk:stats.atk,damage:Math.round(damage/20),deaths,runs:20,estimatedSoloEntries:Math.ceil(boss.calc.maxHp/Math.max(1,damage/20))});
 }}finally{Math.random=random;}
 const report={date:new Date().toISOString(),mode:'actual completed Lv50 growth profiles; base combat screening, full-loop acceptance separate',characters:chars.length,runs:rows.length*20,rows};fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
 for(const b of monsters){const group=rows.filter(r=>r.zone===b.zone);console.log(b.name,'HP',b.calc.maxHp,'team avg per-entry',Math.round(group.reduce((n,r)=>n+r.damage,0)/group.length),'deaths',group.reduce((n,r)=>n+r.deaths,0)+'/'+group.length*20);}
 await closeMongoClient();
}
module.exports={loadCharacters};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;closeMongoClient()});
