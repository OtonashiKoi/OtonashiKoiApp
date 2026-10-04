'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const {loadBson}=require('./verify-normal-progression');
const {SET_DEFS,getRegionalSetProcChance,getSetEffects}=require('../src/shared/equipmentSetBonuses');
const {buildItemEffectLines}=require('../src/shared/itemEffectLines');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {runCombatLoop}=require('../src/shared/combatLoop');
const snapshot=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11),backup=process.argv.find(a=>a.startsWith('--before-source='))?.slice(16);
assert.ok(snapshot&&backup);const oldModule={exports:{}};vm.runInNewContext(fs.readFileSync(backup,'utf8'),{module:oldModule,exports:oldModule.exports,require:createRequire(path.resolve('src/shared/equipmentSetBonuses.js'))});
const serialize=(tier,key)=>JSON.stringify({...tier,effects:tier.effects?.({},key)||null});let unchanged=0;
for(const [key,def]of Object.entries(SET_DEFS))for(const tier of def.tiers){if(['hellfire_p','hellfire_m','mithril_p','mithril_m','steel_p','steel_m'].includes(key)&&tier.count===5)continue;assert.equal(serialize(tier,key),serialize(oldModule.exports.SET_DEFS[key].tiers.find(t=>t.count===tier.count),key));unchanged++;}
const items=loadBson(path.join(snapshot,'items.bson')),rows=[];const previous=Math.random;Math.random=()=>.5;
try{for(const weapon of items.filter(i=>i.tier==='S'&&i.equipSlot==='weapon'&&['magnetic_p','magnetic_m','dragonscale_p','dragonscale_m','hellfire_p','hellfire_m','mithril_p','mithril_m'].includes(i.setKey))){
 const equipped={weapon};for(const item of items.filter(i=>i.tier==='A'&&i.setKey===weapon.setKey&&i.equipSlot!=='weapon')){if(!equipped[item.equipSlot])equipped[item.equipSlot]=item;if(Object.keys(equipped).length===5)break;}
 assert.equal(Object.keys(equipped).length,5,weapon.id+' missing A armor');
 const chance=getRegionalSetProcChance(equipped,weapon.setKey);assert.equal(chance,weapon.setKey.startsWith('magnetic')?12:weapon.setKey.startsWith('dragon')?45:30,weapon.id);
 assert.ok(buildItemEffectLines(weapon).some(line=>line.includes('主手裝備同系列 S 武器')),weapon.id+' live display');
 const stats=calcPlayerStats({str:20,int:20,vit:20,agi:20,dex:20,luk:20},equipped,[],[],{zone:'normal'});
 const result=runCombatLoop({...stats,maxHp:10000},{maxHp:50000,atk:100,agi:stats.agi,def:0,dex:10,luk:10,dodge:0,hit:100},'資料庫裝備木樁',50000,2,{equipped,zone:'normal'});
 assert.ok(Number.isFinite(result.totalDamage)&&result.totalDamage>0);rows.push({id:weapon.id,setKey:weapon.setKey,chance,totalDamage:result.totalDamage,damageTaken:result.damageTaken});
}}
finally{Math.random=previous;}
assert.equal(rows.length,44);const report={passed:true,battles:rows.length,unchangedTiers:unchanged,rows};const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,battles:rows.length,unchangedTiers:unchanged}));
