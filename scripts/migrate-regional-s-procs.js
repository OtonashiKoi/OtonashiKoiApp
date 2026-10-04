'use strict';
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');const {SET_DEFS}=require('../src/shared/equipmentSetBonuses');
const {buildItemEffectLines}=require('../src/shared/itemEffectLines');
function read(dir,name){const b=fs.readFileSync(path.join(dir,name+'.bson')),r=[];for(let p=0;p<b.length;){const n=b.readInt32LE(p);assert.ok(n>=5&&p+n<=b.length);r.push(BSON.deserialize(b.subarray(p,p+n)));p+=n;}return r;}
function plan(rows){return rows.map(old=>{
 const next={...structuredClone(old),_id:old._id};const trait=['magnetic_p','magnetic_m','dragonscale_p','dragonscale_m'].includes(old.setKey);
 if(trait){const desc=SET_DEFS[old.setKey].tiers.find(t=>t.count===5).desc;
  if(old.setKey.startsWith('magnetic'))next.description=next.description.replace(/5 件：磁力偏移：[^；]*（僅自身套裝）/,`5 件：${desc}`);
  else next.description=next.description.replace('5 件：龍鱗反傷：反彈實際物理承傷的 12%',`5 件：${desc}`);
 }
 if(old.tier==='S'&&old.equipSlot==='weapon'){
  for(const bucket of ['passiveEffects','procEffects','combatEffects','useEffects'])if(Array.isArray(old[bucket]))next[bucket]=old[bucket].filter(e=>!(e.key==='final_damage_up'&&Array.isArray(e.condition?.zone)&&Number(e.params?.value)===20));
  if(JSON.stringify(old.passiveEffects)!==JSON.stringify(next.passiveEffects))next.description=(next.description||'').replace('；於【龍族之領／龍王巢穴】造成的傷害 +20%（屠龍特攻）','').replace(/【真銀特攻】於古城／古城深處／大史王之地，造成傷害 \+20%。/,'').trim();
 }
 return {old,next};}).filter(x=>JSON.stringify(x.old)!==JSON.stringify(x.next));}
(async()=>{const dir=process.argv.find(x=>x.startsWith('--backup-dir='))?.slice(13);assert.ok(dir&&path.isAbsolute(dir));const rows=read(dir,'items'),changes=plan(rows);assert.equal(changes.filter(x=>JSON.stringify(x.old.passiveEffects)!==JSON.stringify(x.next.passiveEffects)).length,33);
 for(const {old,next} of changes){const restored={...next,description:old.description};for(const k of ['passiveEffects','procEffects','combatEffects','useEffects'])if(old[k]!==undefined)restored[k]=old[k];assert.deepEqual(restored,old);if(['magnetic_p','magnetic_m','dragonscale_p','dragonscale_m'].includes(next.setKey))assert.ok(buildItemEffectLines(next).some(t=>t.includes('同類 S 裝提高至')));}
 fs.writeFileSync(path.join(dir,'s-proc-plan.json'),JSON.stringify({items:changes.length,removedZoneDamageWeapons:33,changes:changes.map(x=>({id:x.old.id,fields:Object.keys(x.next).filter(k=>JSON.stringify(x.next[k])!==JSON.stringify(x.old[k]))}))},null,2));
 if(!process.argv.includes('--apply'))return console.log(`Preview: ${changes.length} items; 33 regional weapon bonuses removed`);
 const c=await MongoClient.connect(process.env.MONGODB_URI);try{const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read(dir,'maintenanceState'));
 for(const x of changes)assert.deepEqual(await db.collection('items').findOne({_id:x.old._id}),x.old);
 for(const x of changes){const fields={};for(const k of Object.keys(x.next))if(JSON.stringify(x.next[k])!==JSON.stringify(x.old[k]))fields[k]=x.next[k];assert.equal((await db.collection('items').updateOne(x.old,{$set:fields})).matchedCount,1);}
 const expected=new Map(changes.map(x=>[String(x.old._id),x.next]));for(const old of rows)assert.deepEqual(await db.collection('items').findOne({_id:old._id}),expected.get(String(old._id))||old);
 assert.deepEqual(await db.collection('monsters').find({}).toArray(),read(dir,'monsters'));assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read(dir,'maintenanceState'));console.log(`PASS: ${changes.length} items read back; monster drops and login gate unchanged`);
 }finally{await c.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
