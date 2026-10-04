"use strict";
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const {buildMetalContent}=require('./lib/metal-content');
async function main(){
 const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
 const apply=process.argv.includes('--apply'),backup=arg('--backup-dir'),candidate=arg('--candidate');
 if(apply)assert.ok(backup&&path.isAbsolute(backup)&&!path.resolve(backup).startsWith(path.resolve(__dirname,'..')+'/'));
 const c=await MongoClient.connect(process.env.MONGODB_URI);
 try {const db=c.db(process.env.MONGODB_DB_NAME),source={};
 for(const name of ['items','monsters','channelLayout','worldBossConfig','maintenanceState'])source[name]=await db.collection(name).find({}).toArray();
 const p=candidate?JSON.parse(fs.readFileSync(candidate)):buildMetalContent(source.items,source.monsters);
 assert.equal(p.gear.length,60);assert.equal(p.mobs.length,8);assert.equal(p.config._id,'steel_crown');
 const all=[...source.items,...p.gear];
 for(const m of p.mobs)for(const d of m.drops)assert.ok(all.some(i=>i.id===d.itemId),'Missing drop '+d.itemId);
 console.log(JSON.stringify({mode:apply?'apply':'preview',gear:p.gear.length,mobs:p.mobs.length,config:p.config._id}));
 if(!apply)return;
 fs.mkdirSync(backup,{recursive:true});
 for(const [name,rows]of Object.entries(source)){
   const file=path.join(backup,name+'.bson');fs.writeFileSync(file,Buffer.concat(rows.map(x=>BSON.serialize(x))),{flag:'wx'});
   const bytes=fs.readFileSync(file);let n=0,off=0;while(off<bytes.length){const len=bytes.readInt32LE(off);assert.deepEqual(BSON.deserialize(bytes.subarray(off,off+len)),rows[n++]);off+=len;}assert.equal(n,rows.length);
   fs.writeFileSync(path.join(backup,name+'.metadata.json'),JSON.stringify({count:n,indexes:await db.collection(name).indexes()}),{flag:'wx'});
 }
 // Inspect every collision before first write; no existing content is replaced.
 for(const [collection,rows]of [['items',p.gear],['monsters',p.mobs]])for(const row of rows){
   const old=await db.collection(collection).findOne({id:row.id});
   if(old){const {_id,...rest}=old;assert.deepEqual(rest,row,'Existing content differs '+row.id);}
 }
 const oldConfig=source.worldBossConfig.find(x=>x._id===p.config._id);if(oldConfig)assert.deepEqual(oldConfig,p.config);
 for(const [collection,rows]of [['items',p.gear],['monsters',p.mobs]])for(const row of rows){
   await db.collection(collection).updateOne({id:row.id},{$setOnInsert:structuredClone(row)},{upsert:true});
 }
 await db.collection('worldBossConfig').updateOne({_id:p.config._id},{$setOnInsert:structuredClone(p.config)},{upsert:true});
 for(const old of source.channelLayout){
   if(!Array.isArray(old.value?.discord?.bindings))continue;
   const bindings=structuredClone(old.value.discord.bindings);
   for(const [featureKey,minLevel]of [['monster_zone_metal_mine',40],['monster_zone_metal_throne',50]]){
     if(!bindings.some(b=>b.featureKey===featureKey))bindings.push({featureKey,channelId:'',enabled:true,note:'網頁入口已開設；Discord 尚未綁定頻道',panelMessageId:'',visibleTo:{player:true,admin:true},minLevel,maxLevel:null});
   }
   const r=await db.collection('channelLayout').updateOne({_id:old._id,value:old.value},{$set:{'value.discord.bindings':bindings}});assert.equal(r.matchedCount,1,'Concurrent layout change');
 }
 for(const [collection,rows]of [['items',p.gear],['monsters',p.mobs]])for(const row of rows){const {_id,...live}=await db.collection(collection).findOne({id:row.id});assert.deepEqual(live,row);}
 assert.deepEqual(await db.collection('worldBossConfig').findOne({_id:p.config._id}),p.config);
 assert.deepEqual(await db.collection('maintenanceState').find({}).toArray(),source.maintenanceState);
 fs.writeFileSync(path.join(backup,'verified.json'),JSON.stringify({gear:60,mobs:8,worldBossConfigReadback:true,maintenanceUnchanged:true}),{flag:'wx'});
 console.log('PASS: 60 gear / 8 monsters / boss config read back; maintenance unchanged');
 }finally{await c.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
