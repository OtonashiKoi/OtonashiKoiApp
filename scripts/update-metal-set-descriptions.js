"use strict";
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {SET_DEFS}=require('../src/shared/equipmentSetBonuses');
const {buildItemEffectLines}=require('../src/shared/itemEffectLines');
async function main(){
 const backup=process.argv.find(x=>x.startsWith('--backup-dir='))?.slice(13);assert.ok(backup&&path.isAbsolute(backup));
 const read=name=>{const b=fs.readFileSync(path.join(backup,name+'.bson')),rows=[];for(let p=0;p<b.length;){const n=b.readInt32LE(p);rows.push(BSON.deserialize(b.subarray(p,p+n)));p+=n;}return rows;};
 const rows=read('items').filter(i=>String(i.id).startsWith('metal-'));assert.equal(rows.length,60);
 const updates=rows.map(old=>({old,description:`${old.tier} 階金屬主題裝備；${old.tier==='A'?'鐵鳴礦城':'鎧冕王・赫鋼'}掉落。${old.setName}，A／S 同類可混搭、沿用階級套裝。`+SET_DEFS[old.setKey].tiers.map(t=>`${t.count} 件：${t.desc}`).join('；')+'。屬性攻擊／抗性依鑲嵌屬性石生效。'}));
 const c=await MongoClient.connect(process.env.MONGODB_URI);
 try{const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 for(const u of updates){const live=await db.collection('items').findOne({_id:u.old._id});assert.ok(JSON.stringify(live)===JSON.stringify(u.old)||JSON.stringify(live)===JSON.stringify({...u.old,description:u.description}),'Concurrent gear edit');}
 if(!process.argv.includes('--apply'))return console.log('Preview: 60 descriptions only');
 for(const u of updates){const live=await db.collection('items').findOne({_id:u.old._id});assert.equal((await db.collection('items').updateOne(live,{$set:{description:u.description}})).matchedCount,1);const out=await db.collection('items').findOne({_id:u.old._id});assert.deepEqual(out,{...u.old,description:u.description});assert.ok(buildItemEffectLines(out).includes('5 件：磁力偏移：8% 機率使物理攻擊傷害歸零（僅自身套裝）'));}
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 fs.writeFileSync(path.join(backup,'description-readback.json'),JSON.stringify({items:60,otherItemFieldsUnchanged:true,maintenanceUnchanged:true,at:new Date().toISOString()},null,2));console.log('PASS: 60 magnetic deflection descriptions; stats, other fields and login gates unchanged');
 }finally{await c.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
