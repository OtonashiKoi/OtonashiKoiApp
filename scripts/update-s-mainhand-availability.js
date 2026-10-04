'use strict';
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {isDisabledSEquipment}=require('../src/shared/sEquipmentFeature');
(async()=>{
 const dir=process.argv.find(x=>x.startsWith('--backup-dir='))?.slice(13);assert.ok(dir&&path.isAbsolute(dir));
 const read=name=>{const b=fs.readFileSync(path.join(dir,name+'.bson')),r=[];for(let p=0;p<b.length;){const n=b.readInt32LE(p);assert.ok(n>=5&&p+n<=b.length);r.push(BSON.deserialize(b.subarray(p,p+n)));p+=n;}return r;};
 const originals=read('items'),note='【暫未開放】S 防具、飾品與副手暫停取得及使用；既有收藏保留，屬性與效果不生效。';
 const changes=originals.map(old=>{let description=(old.description||'').replaceAll('含同類 S 裝提高至','主手裝備同系列 S 武器提高至');if(isDisabledSEquipment(old)&&!description.includes(note))description+=' '+note;return{old,description};}).filter(x=>x.old.description!==x.description);
 const c=await MongoClient.connect(process.env.MONGODB_URI);try{const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 for(const x of changes)assert.deepEqual(await db.collection('items').findOne({_id:x.old._id}),x.old);
 const report={items:changes.length,pausedNonWeapons:originals.filter(isDisabledSEquipment).length,descriptionOnly:true};
 if(!process.argv.includes('--apply'))return console.log(JSON.stringify({...report,preview:true}));
 for(const x of changes)assert.equal((await db.collection('items').updateOne(x.old,{$set:{description:x.description}})).matchedCount,1);
 const expected=new Map(changes.map(x=>[String(x.old._id),{...x.old,description:x.description}]));for(const old of originals)assert.deepEqual(await db.collection('items').findOne({_id:old._id}),expected.get(String(old._id))||old);
 for(const name of ['monsters','maintenanceState'])assert.deepEqual(await db.collection(name).find({}).toArray(),read(name));
 fs.writeFileSync(path.join(dir,'availability-readback.json'),JSON.stringify({...report,otherFieldsAndCollectionsUnchanged:true},null,2));console.log(JSON.stringify(report));
 }finally{await c.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
