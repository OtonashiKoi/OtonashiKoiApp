"use strict";
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {SET_DEFS}=require('../src/shared/equipmentSetBonuses');
const {buildItemEffectLines}=require('../src/shared/itemEffectLines');
async function main(){
 const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
 const backup=arg('--backup-dir');assert.ok(backup&&path.isAbsolute(backup));
 const read=name=>{const bytes=fs.readFileSync(path.join(backup,name+'.bson')),rows=[];for(let p=0;p<bytes.length;){const n=bytes.readInt32LE(p);rows.push(BSON.deserialize(bytes.subarray(p,p+n)));p+=n;}return rows;};
 const sourceItems=read('items').filter(i=>String(i.id).startsWith('metal-'));
 const sourceMobs=read('monsters').filter(m=>['metal_mine','metal_throne'].includes(m.zone));
 assert.equal(sourceItems.length,60);assert.equal(sourceMobs.length,8);
 for(let n=1;n<=8;n++)assert.ok(fs.existsSync(path.join(__dirname,`../src/web/public/uploads/monsters/metal-${n}-v2.png`)));
 const client=await MongoClient.connect(process.env.MONGODB_URI);
 try{const db=client.db(process.env.MONGODB_DB_NAME||'equipment_game');
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 const updates=sourceItems.map(i=>({collection:'items',old:i,fields:{description:`${i.tier} 階金屬主題裝備；${i.tier==='A'?'鐵鳴礦城':'鎧冕王・赫鋼'}掉落。${i.setName}，A／S 同類可混搭、沿用階級套裝。`+SET_DEFS[i.setKey].tiers.map(t=>`${t.count} 件：${t.desc}`).join('；')+'。屬性攻擊／抗性依鑲嵌屬性石生效。'}}));
 sourceMobs.forEach(m=>{const n=m.zone==='metal_throne'?8:m.seq;updates.push({collection:'monsters',old:m,fields:{imageUrl:`/uploads/monsters/metal-${n}-v2.png`,imageThumbnailUrl:`/uploads/monsters/metal-${n}-v2.png`}});});
 // Check all rows before writing; permit safe repeat after an interrupted partial run.
 for(const u of updates){const live=await db.collection(u.collection).findOne({_id:u.old._id});assert.ok(JSON.stringify(live)===JSON.stringify(u.old)||JSON.stringify(live)===JSON.stringify({...u.old,...u.fields}),'Concurrent content edit: '+u.old.id);}
 if(!process.argv.includes('--apply'))return console.log('Preview: 60 descriptions / 8 image references');
 for(const u of updates){const live=await db.collection(u.collection).findOne({_id:u.old._id});const r=await db.collection(u.collection).updateOne(live,{$set:u.fields});assert.equal(r.matchedCount,1);const out=await db.collection(u.collection).findOne({_id:u.old._id});assert.deepEqual(out,{...u.old,...u.fields});if(u.collection==='items'){const lines=buildItemEffectLines(out);for(const t of SET_DEFS[out.setKey].tiers)assert.ok(lines.includes(`${t.count} 件：${t.desc}`));if(out.weaponType==='dice')assert.ok(lines.some(l=>l.includes('常駐無視 25% DEF')));}}
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 fs.writeFileSync(path.join(backup,'presentation-readback.json'),JSON.stringify({descriptions:60,images:8,statsAndDropsUnchanged:true,maintenanceUnchanged:true,at:new Date().toISOString()},null,2));
 console.log('PASS: 60 descriptions / 8 generated-image references read back; stats, drops and maintenance unchanged');
 }finally{await client.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
