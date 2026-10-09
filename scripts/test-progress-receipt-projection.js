'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const {MongoMemoryServer}=require('mongodb-memory-server'),mongo=await MongoMemoryServer.create();
 process.env.MONGODB_URI=mongo.getUri();process.env.MONGODB_DB_NAME='qa_receipt_projection';
 const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
 try{
 const db=await getMongoDb(),sc=require('../src/services/createServiceContext').createServiceContext(),pid='projection-player';
 await sc.playerService.ensurePlayer(pid,pid);
 const drops=Array.from({length:4000},(_,i)=>({id:'old-drop-'+i,entries:[{uuid:'receipt-'+i,itemId:'old',description:'x'.repeat(600)}]}));
 const oldExp=Array.from({length:4000},(_,i)=>'normal-live:old-'+i);
 await db.collection('progress').updateOne({playerId:pid},{$set:{normalLiveDropReceipts:drops,normalLiveExpResults:oldExp.map(id=>({id,levelUps:0})),expGrantReceipts:oldExp,inventory:[{uuid:'owned',itemId:'owned',stackCount:1}],level:1,exp:0}});
 const full=await sc.progressRepository.findByPlayerId(pid,{includeLiveRewardReceipts:true}),small=await sc.progressRepository.findByPlayerId(pid);
 assert.equal(small.normalLiveDropReceipts,undefined);assert.equal(small.normalLiveExpResults,undefined);assert.equal(full.normalLiveDropReceipts.length,4000);
 small.statusPoints=7;await sc.progressRepository.saveIfUnchanged(small,small.updatedAt);
 let raw=await db.collection('progress').findOne({playerId:pid});assert.equal(raw.normalLiveDropReceipts.length,4000);assert.equal(raw.normalLiveExpResults.length,4000);assert.equal(raw.inventory[0].uuid,'owned');
 const id='normal-live:new-exp',input={discordId:pid,displayName:pid,amount:1,source:require('../src/shared/sources').EXP_SOURCES.MONSTER_KILL,operationId:id};
 const projected=await sc.progressRepository.findExpRewardProgress(pid,id);assert.equal(projected.expGrantReceipts.length,0);assert.equal(projected.normalLiveExpResults.length,0);
 await sc.progressService.grantExp(input);await sc.progressService.grantExp(input);
 raw=await db.collection('progress').findOne({playerId:pid});assert.equal(raw.exp,1);for(const [field,total] of [['expGrantReceipts',4001],['normalLiveExpResults',4001],['normalLiveDropReceipts',4000]]){
   assert.ok(raw[field].length<=256);assert.equal(raw[field].length+await db.collection('progressReceipts').countDocuments({playerId:pid,field}),total);
 }
 const relocated=await db.collection('normalLiveRewardReceipts').find({playerId:pid}).toArray();assert.equal(relocated.length,4000);
 for(const receipt of relocated)assert.deepEqual(receipt.entries,drops.find(r=>r.id===receipt.id).entries);
 const duplicate=await sc.progressRepository.findExpRewardProgress(pid,id);assert.deepEqual(duplicate.expGrantReceipts,[id]);assert.equal(duplicate.normalLiveExpResults.length,1);
 console.log('PASS 4000 historical receipts excluded from gameplay reads, preserved by saves, new EXP atomic append, duplicate reward exactly once');
 }finally{await closeMongoClient();await mongo.stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
