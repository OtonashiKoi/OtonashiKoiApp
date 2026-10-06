'use strict';
require('dotenv').config();
const assert=require('node:assert/strict');
process.env.MONGODB_DB_NAME='qa_live_exp_fields_'+Date.now();
const {getMongoDb}=require('../src/adapters/mongo/createMongoClient');
const {createServiceContext}=require('../src/services/createServiceContext');
const {expToNextLevel,MAX_LEVEL}=require('../src/shared/progression');
const {MAX_LEVEL_EXP_TO_GOLD_DIVISOR}=require('../src/shared/normalEconomy');
(async()=>{
 const db=await getMongoDb(),sc=createServiceContext(),pid='qa_exp_fields';assert.equal(db.databaseName,process.env.MONGODB_DB_NAME);
 await sc.playerService.ensurePlayer(pid,pid);
 const originalItem={uuid:'owned',itemId:'qa-owned',itemName:'保留裝備',enchantments:[{key:'str',value:7}],locked:true};
 await sc.progressRepository.updateFields(pid,{level:10,exp:0,statusPoints:0,attributes:{str:1,agi:1,vit:1,int:1,dex:1,luk:1},inventory:[originalItem],equipment:{armor:{...originalItem}},activeEffects:[{id:'keep'}],activeCharacterSlot:1});
 const before=await db.collection('progress').findOne({playerId:pid});
 const projection=await sc.progressRepository.findExpRewardProgress(pid);
 assert.equal(projection.inventory,undefined);assert.equal(projection.equipment,undefined);assert.equal(projection.activeEffects,undefined);
 const events=[];const unsub=require('../src/services/realtime/playerEventBus').playerEventBus.subscribe(pid,e=>events.push(e));
 const save=sc.progressRepository.saveExpRewardIfUnchanged.bind(sc.progressRepository);let raced=false;
 sc.progressRepository.saveExpRewardIfUnchanged=async(p,at,operationId)=>{
  if(!raced){raced=true;await db.collection('progress').updateOne({playerId:pid},{$push:{inventory:{uuid:'arrived',itemId:'qa-concurrent',locked:true}},$set:{statusPoints:7,'attributes.str':9,updatedAt:new Date(Date.parse(at)+2).toISOString()}});}
  return save(p,at,operationId);
 };
 const input={discordId:pid,displayName:pid,amount:expToNextLevel(10)+5,source:'monster:kill',operationId:'normal-live:qa:exp',rewardCharacter:{seasonKey:projection.seasonKey,slot:1}};
 // Keep the source from the production constant rather than duplicating its spelling.
 input.source=require('../src/shared/sources').EXP_SOURCES.MONSTER_KILL;
 const result=await sc.progressService.grantExp(input);assert.equal(result.levelUps,1);assert.equal(result.progress.level,11);assert.equal(result.progress.exp,5);
 let after=await db.collection('progress').findOne({playerId:pid});
 assert.deepEqual(after.inventory,[...before.inventory,{uuid:'arrived',itemId:'qa-concurrent',locked:true}]);assert.deepEqual(after.equipment,before.equipment);assert.deepEqual(after.activeEffects,before.activeEffects);
 assert.equal(after.statusPoints,8);assert.equal(Object.values(after.attributes).reduce((a,b)=>a+b,0),15);assert.equal(after.expGrantReceipts.length,1);
 assert.equal(events.filter(e=>e.type==='level_up').length,1);assert.equal(events.filter(e=>e.type==='inventory_invalidate').length,0,'EXP alone does not reload the bag');
 assert.equal((await sc.progressService.grantExp(input)).duplicate,true);assert.equal(events.filter(e=>e.type==='level_up').length,1);
 sc.progressRepository.saveExpRewardIfUnchanged=save;
 await sc.progressRepository.updateFields(pid,{level:MAX_LEVEL,exp:0});
 const walletBefore=await sc.walletRepository.findByPlayerId(pid),overflow={...input,amount:MAX_LEVEL_EXP_TO_GOLD_DIVISOR*9,operationId:'normal-live:qa:overflow'};
 assert.equal((await sc.progressService.grantExp(overflow)).overflowGold,9);await sc.progressService.grantExp(overflow);
 assert.equal((await sc.walletRepository.findByPlayerId(pid)).gold,walletBefore.gold+9,'overflow currency receipt must remain idempotent');
 await sc.progressRepository.updateFields(pid,{activeCharacterSlot:2});
 await assert.rejects(sc.progressService.grantExp({...input,operationId:'normal-live:qa:wrong-slot'}),/character changed/);
 const old=await sc.progressRepository.findExpRewardProgress(pid);await db.collection('progress').updateOne({playerId:pid},{$set:{seasonKey:'qa-other-season'}});
 assert.equal(await save({...old,exp:99999,updatedAt:new Date().toISOString()},old.updatedAt),false);
 await assert.rejects(sc.progressService.grantExp({...input,operationId:'normal-live:qa:wrong-season'}),/current-season/);
 after=await db.collection('progress').findOne({playerId:pid});assert.equal(after.exp,0);assert.equal(after.inventory.length,2);
 unsub();console.log('PASS live EXP: small field read/write, concurrent loot/stat edit, CAS retry, single level-up, overflow retry, season/character guards');process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});
