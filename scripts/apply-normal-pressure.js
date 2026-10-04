'use strict';
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {loadBson}=require('./verify-normal-progression');
async function main(){
 const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
 const p=JSON.parse(fs.readFileSync(arg('--plan'))),source=loadBson(arg('--snapshot')+'/monsters.bson');
 assert.equal(p.revision,'normal-pressure-20261002-v1');
 const changes=p.plan.filter(r=>r.values.str!=null);assert.ok(changes.length);
 for(const r of changes)assert.deepEqual(Object.keys(r.values).sort(),['normalPressureRevision','str']);
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({mode:'preview',count:changes.length}));return;}
 const backup=arg('--backup-dir');assert.ok(backup&&path.isAbsolute(backup)&&!backup.startsWith(path.resolve(__dirname,'..')+'/'));
 fs.mkdirSync(backup,{recursive:true});const c=await MongoClient.connect(process.env.MONGODB_URI);
 try{
  const db=c.db(process.env.MONGODB_DB_NAME||'equipment_game'),snap={};
  for(const name of ['monsters','items','maintenanceState']){
   snap[name]=await db.collection(name).find({}).toArray();
   fs.writeFileSync(backup+'/'+name+'.bson',Buffer.concat(snap[name].map(x=>BSON.serialize(x))),{flag:'wx'});
   assert.deepEqual(loadBson(backup+'/'+name+'.bson'),snap[name]);
   fs.writeFileSync(backup+'/'+name+'.metadata.json',JSON.stringify({count:snap[name].length,indexes:await db.collection(name).indexes()}),{flag:'wx'});
  }
  for(const r of changes){const old=snap.monsters.find(m=>m.id===r.id),original=source.find(m=>m.id===r.id);
   assert.ok(old&&!old.isBoss&&!old.allZones&&!old.incomingDamageCap);
   assert.deepEqual(old,original,'concurrent monster edit: '+r.name);
   assert.ok(r.values.str>=old.str&&r.values.str<=Math.ceil(old.str*1.3));
  }
  fs.writeFileSync(backup+'/plan.json',JSON.stringify(p,null,2),{flag:'wx'});
  for(const r of changes){const old=snap.monsters.find(m=>m.id===r.id);const result=await db.collection('monsters').updateOne(old,{$set:r.values});assert.equal(result.matchedCount,1,'CAS conflict: '+r.id);}
  for(const old of snap.monsters){const live=await db.collection('monsters').findOne({_id:old._id}),r=changes.find(x=>x.id===old.id);assert.deepEqual(live,{...old,...r?.values});}
  for(const name of ['items','maintenanceState'])assert.deepEqual(await db.collection(name).find({}).toArray(),snap[name]);
  fs.writeFileSync(backup+'/verified.json',JSON.stringify({changed:changes.length,onlyFields:['str','normalPressureRevision'],itemsUnchanged:true,maintenanceUnchanged:true,bossesAndStatesUnchanged:true,verifiedAt:new Date().toISOString()},null,2));
  console.log('VERIFIED: '+changes.length+' ordinary attacks updated; HP/DEF/AGI/rewards/drops/bosses/state/items/maintenance unchanged');
 }finally{await c.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
