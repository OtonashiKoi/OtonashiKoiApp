'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { BSON, MongoClient } = require('mongodb');
const { QUEST_ID, TITLE_ID, questPatch, titleItem } = require('../src/shared/partyWeeklyReward');
function parse(bytes) {
 const docs=[];for(let i=0;i<bytes.length;){const n=bytes.readInt32LE(i);assert(n>=5&&i+n<=bytes.length);docs.push(BSON.deserialize(bytes.subarray(i,i+n)));i+=n;}return docs;
}
async function migrate(db,{backup,apply=false}) {
 const filters={weeklyQuests:{id:QUEST_ID},items:{id:{$in:[TITLE_ID,...questPatch.rewardItems.map(r=>r.itemId)]}},maintenanceState:{},gameSeasonState:{}};
 const before={};for(const [name,filter] of Object.entries(filters))before[name]=await db.collection(name).find(filter).toArray();
 const quest=before.weeklyQuests[0];assert(quest&&quest.enabled&&quest.cadence==='weekly'&&quest.type==='party_floor_clear'&&quest.groupKey==='autumn_202610_v1');
 for(const r of questPatch.rewardItems.filter(r=>r.itemId!==TITLE_ID))assert(before.items.some(i=>i.id===r.itemId),'gem missing');
 const existing=before.items.find(i=>i.id===TITLE_ID);
 if(existing)for(const [k,v] of Object.entries(titleItem))assert.deepEqual(existing[k],v,'existing title differs');
 if(!apply){
  assert(backup,'backup directory required');fs.mkdirSync(backup,{recursive:true});
  for(const [name,docs] of Object.entries(before)){
   const file=path.join(backup,name+'.bson');assert(!fs.existsSync(file),'do not overwrite backup');
   fs.writeFileSync(file,Buffer.concat(docs.map(d=>BSON.serialize(d))));
   const metadata={indexes:await db.collection(name).listIndexes().toArray(),count:docs.length,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
   fs.writeFileSync(path.join(backup,name+'.metadata.json'),JSON.stringify(metadata,null,2));
   assert.deepEqual(parse(fs.readFileSync(file)),docs);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backup,name+'.metadata.json'))),metadata);
  }
  return {apply:false,backup,questId:QUEST_ID,patch:questPatch,title:titleItem};
 }
 for(const [name,docs] of Object.entries(before)){
  const bytes=fs.readFileSync(path.join(backup,name+'.bson')),meta=JSON.parse(fs.readFileSync(path.join(backup,name+'.metadata.json')));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),meta.sha256);assert.equal(parse(bytes).length,meta.count);
  assert.deepEqual(parse(bytes),docs,'data changed after preview; take new backup');
  assert.deepEqual(await db.collection(name).listIndexes().toArray(),meta.indexes);
 }
 const now=new Date().toISOString();
 if(!existing)await db.collection('items').insertOne({...titleItem,createdAt:now,updatedAt:now});
 const result=await db.collection('weeklyQuests').updateOne(quest,{$set:{...questPatch,updatedAt:now}});assert.equal(result.matchedCount,1,'quest changed during apply');
 const live=await db.collection('weeklyQuests').findOne({id:QUEST_ID});for(const [k,v] of Object.entries(questPatch))assert.deepEqual(live[k],v);
 const item=await db.collection('items').findOne({id:TITLE_ID});for(const [k,v] of Object.entries(titleItem))assert.deepEqual(item[k],v);
 for(const name of ['maintenanceState','gameSeasonState'])assert.deepEqual(await db.collection(name).find({}).toArray(),before[name]);
 return {apply:true,quest:live,title:item,playerProgressUntouched:true};
}
async function main(){require('dotenv').config({quiet:true});const config=require('../src/config');const client=await MongoClient.connect(config.storage.mongoUri);try{console.log(JSON.stringify(await migrate(client.db(config.storage.mongoDbName),{backup:process.argv.find(a=>a.startsWith('--backup='))?.slice(9),apply:process.argv.includes('--apply')}),null,2));}finally{await client.close();}}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={migrate};
