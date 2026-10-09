"use strict";
require('dotenv').config({quiet:true});const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{MongoClient}=require('mongodb'),{serialize,deserialize}=require('bson');
const {candidate}=require('./lib/hutao-live-content');
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);assert.ok(output&&path.isAbsolute(output)&&!path.resolve(output).startsWith(path.resolve(__dirname,'..')+'/'),'external output required');
(async()=>{
 const client=new MongoClient(process.env.MONGODB_URI);await client.connect();try{
 const db=client.db(process.env.MONGODB_DB_NAME),card=await db.collection('items').findOne({id:'monster-card-northwind-hutao'}),monster=await db.collection('monsters').findOne({id:'event-northwind-hutao'}),config=await db.collection('worldBossConfig').findOne({_id:'northwind_hutao'});assert.ok(card&&monster&&config);
 const next=candidate(card,monster,config);fs.mkdirSync(output,{recursive:false});
 for(const name of ['items','monsters','worldBossConfig','maintenanceState']){
 const rows=await db.collection(name).find({}).toArray(),bytes=Buffer.concat(rows.map(r=>serialize(r)));fs.writeFileSync(path.join(output,name+'.bson'),bytes);let offset=0,parsed=[];while(offset<bytes.length){const size=bytes.readInt32LE(offset);parsed.push(deserialize(bytes.subarray(offset,offset+size)));offset+=size;}assert.deepEqual(parsed,rows);fs.writeFileSync(path.join(output,name+'.metadata.json'),JSON.stringify({count:rows.length,indexes:await db.collection(name).indexes()},null,2));
 }
 fs.writeFileSync(path.join(output,'candidate.json'),JSON.stringify(next,null,2));
 if(!process.argv.includes('--apply')){console.log('DRY RUN: backup parse-verified, candidate saved; no production writes');return;}
 // Compare the source fields before each narrow update to reject concurrent content edits.
 const updates=[['items',card,{description:next.card.description,monsterCardSkill:next.card.monsterCardSkill}],['monsters',monster,{entryFee:50000,'equipment.special_1.description':next.card.description,'equipment.special_1.monsterCardSkill':next.card.monsterCardSkill}],['worldBossConfig',config,{'value.respawnCooldownMinutes':next.config.value.respawnCooldownMinutes,'value.phaseConfig':[]}]];
 function at(object,key){return key.split('.').reduce((v,k)=>v?.[k],object);}
 for(const [name,before,fields] of updates){const filter={_id:before._id};for(const key of Object.keys(fields))filter[key]=at(before,key)??{$exists:false};const result=await db.collection(name).updateOne(filter,{$set:fields});assert.equal(result.matchedCount,1,`concurrent ${name} content change`);}
 const after={card:await db.collection('items').findOne({_id:card._id}),monster:await db.collection('monsters').findOne({_id:monster._id}),config:await db.collection('worldBossConfig').findOne({_id:config._id})};assert.deepEqual(after,next);assert.equal(after.config.value.enabled,config.value.enabled);assert.equal(after.monster.enabled,monster.enabled);
 fs.writeFileSync(path.join(output,'readback.json'),JSON.stringify(after,null,2));console.log(JSON.stringify({verified:true,entryFee:after.monster.entryFee,skill:after.card.monsterCardSkill.key,chance:after.card.monsterCardSkill.chance,cooldownMinutes:after.config.value.respawnCooldownMinutes,enabled:after.config.value.enabled}));
 }finally{await client.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
