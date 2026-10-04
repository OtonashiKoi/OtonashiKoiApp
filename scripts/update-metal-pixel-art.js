"use strict";
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
async function main(){
 const backup=process.argv.find(x=>x.startsWith('--backup-dir='))?.slice(13);assert.ok(backup&&path.isAbsolute(backup));
 const read=name=>{const b=fs.readFileSync(path.join(backup,name+'.bson')),rows=[];for(let p=0;p<b.length;){const n=b.readInt32LE(p);rows.push(BSON.deserialize(b.subarray(p,p+n)));p+=n;}return rows;};
 const rows=read('monsters').filter(m=>['metal_mine','metal_throne'].includes(m.zone));assert.equal(rows.length,8);
 const updates=rows.map(old=>{const n=old.zone==='metal_throne'?8:old.seq,url=`/uploads/monsters/metal-${n}-v3.png`;assert.ok(fs.existsSync(path.join(__dirname,'../src/web/public',url)));return {old,fields:{imageUrl:url,imageThumbnailUrl:url}};});
 const c=await MongoClient.connect(process.env.MONGODB_URI);
 try{const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game');
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 for(const u of updates){const live=await db.collection('monsters').findOne({_id:u.old._id});assert.ok(JSON.stringify(live)===JSON.stringify(u.old)||JSON.stringify(live)===JSON.stringify({...u.old,...u.fields}),'Concurrent monster edit');}
 if(!process.argv.includes('--apply'))return console.log('Preview: eight monster image URLs only');
 for(const u of updates){const live=await db.collection('monsters').findOne({_id:u.old._id});assert.equal((await db.collection('monsters').updateOne(live,{$set:u.fields})).matchedCount,1);assert.deepEqual(await db.collection('monsters').findOne({_id:u.old._id}),{...u.old,...u.fields});}
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),read('maintenanceState'));
 fs.writeFileSync(path.join(backup,'image-readback.json'),JSON.stringify({at:new Date().toISOString(),images:updates.map(u=>({id:u.old.id,...u.fields})),otherMonsterFieldsUnchanged:true,maintenanceUnchanged:true},null,2));
 console.log('PASS: eight pixel art references; all other monster fields and maintenance unchanged');
 }finally{await c.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
