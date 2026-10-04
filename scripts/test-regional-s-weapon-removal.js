'use strict';
const fs=require('fs'),{BSON}=require('mongodb'),assert=require('assert/strict');
const {mergeEquippedFromLibrary}=require('../src/shared/effectEngine');
const {calcPlayerStats}=require('../src/shared/combatStats');const {runCombatLoop}=require('../src/shared/combatLoop');
function read(dir){const b=fs.readFileSync(dir+'/items.bson'),rows=[];for(let p=0;p<b.length;){const n=b.readInt32LE(p);rows.push(BSON.deserialize(b.subarray(p,p+n)));p+=n;}return rows;}
(async()=>{const arg=k=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);const before=read(arg('--before')),after=read(arg('--after'));const current=new Map(after.map(i=>[i.id,i]));const weapons=before.filter(i=>i.tier==='S'&&i.equipSlot==='weapon'&&(i.passiveEffects||[]).some(e=>e.key==='final_damage_up'&&e.condition?.zone&&e.params.value===20));assert.equal(weapons.length,33);const rows=[],failures=[];const random=Math.random;Math.random=()=>.5;try{for(const old of weapons){const eq=await mergeEquippedFromLibrary({weapon:{...old,itemId:old.id}}, {findById:async id=>current.get(id)});if(eq.weapon.passiveEffects.some(e=>e.key==='final_damage_up'&&e.condition?.zone&&e.params.value===20))failures.push(old.id+' stale library effect');
 const zones=old.passiveEffects.find(e=>e.key==='final_damage_up'&&e.condition?.zone).condition.zone;const hits=[];
 for(const zone of ['normal',...zones]){const stats={...calcPlayerStats({str:50,int:50,vit:50,agi:10,dex:50,luk:10},eq,[],[],{zone}),maxHp:10000};const r=runCombatLoop(stats,{maxHp:50000,atk:1,def:0,flatDef:0,agi:10,dex:10,luk:10,hit:100,dodge:0,critRate:0},'區域增傷木樁',50000,1,{equipped:eq,zone});hits.push(r.totalDamage);}
 if(hits.some(x=>x!==hits[0]))failures.push(old.id+' zone damage differs');rows.push({id:old.id,zones,hits});}}finally{Math.random=random;}
 const report={passed:!failures.length,failures,weapons:rows.length,battles:rows.reduce((n,r)=>n+r.hits.length,0),rows};fs.writeFileSync(arg('--output'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,weapons:rows.length,battles:report.battles,failures}));if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
