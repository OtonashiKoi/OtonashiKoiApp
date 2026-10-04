'use strict';
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {SET_DEFS}=require('../src/shared/equipmentSetBonuses');
const {buildItemEffectLines}=require('../src/shared/itemEffectLines');
(async()=>{
 const backup=process.argv.find(x=>x.startsWith('--backup-dir='))?.slice(13);assert.ok(backup&&path.isAbsolute(backup));
 const read=name=>{const b=fs.readFileSync(path.join(backup,name+'.bson')),r=[];for(let p=0;p<b.length;){const n=b.readInt32LE(p);assert.ok(n>=5&&p+n<=b.length);r.push(BSON.deserialize(b.subarray(p,p+n)));p+=n;}return r;};
 const keys=['magnetic_p','magnetic_m','dragonscale_p','dragonscale_m'];
 const originals=read('items');const changes=originals.filter(i=>keys.includes(i.setKey)).map(old=>{
  let description=old.description||'';
  if(old.setKey.startsWith('magnetic'))description=description.replace('5 件：鋼鐵護甲：物理承傷 -8%','5 件：'+SET_DEFS[old.setKey].tiers.find(t=>t.count===5).desc);
  else description+=' 5 件：'+SET_DEFS[old.setKey].tiers.find(t=>t.count===5).desc+'；3／7 件效果保留。';
  assert.notEqual(description,old.description);return {old,description};
 });
 const c=await MongoClient.connect(process.env.MONGODB_URI);
 try{const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 for(const u of changes)assert.deepEqual(await db.collection('items').findOne({_id:u.old._id}),u.old,'Concurrent gear changes');
 if(!process.argv.includes('--apply'))return console.log(`Preview: ${changes.length} descriptions only`);
 for(const u of changes){assert.equal((await db.collection('items').updateOne(u.old,{$set:{description:u.description}})).matchedCount,1);assert.ok(buildItemEffectLines({...u.old,description:u.description}).includes('5 件：'+SET_DEFS[u.old.setKey].tiers.find(t=>t.count===5).desc));}
 const expected=new Map(changes.map(u=>[String(u.old._id),{...u.old,description:u.description}]));
 for(const old of originals)assert.deepEqual(await db.collection('items').findOne({_id:old._id}),expected.get(String(old._id))||old);
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 const report={items:changes.length,descriptionOnly:true,otherItemsUnchanged:true,maintenanceUnchanged:true};fs.writeFileSync(path.join(backup,'regional-description-readback.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await c.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
