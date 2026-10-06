'use strict';
const assert=require('node:assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient}=require('mongodb');
async function main(){
 const server=await MongoMemoryServer.create(),client=await MongoClient.connect(server.getUri()),db=client.db('party_weekly_test');
 require('../src/adapters/mongo/createMongoClient').getMongoDb=async()=>db;
 const {QUEST_ID,TITLE_ID,questPatch,titleItem}=require('../src/shared/partyWeeklyReward');
 const {grantAutumnQuestReward}=require('../src/services/weeklyQuest/autumnQuestRewards');
 const {WeeklyQuestService}=require('../src/services/weeklyQuest/weeklyQuestService');
 const currency=require('../src/adapters/mongo/standaloneCurrencySettlement').createStandaloneCurrencySettlement({getDb:async()=>db});
 let failSave=false,failCas=0;
 const progress={findByPlayerId:id=>db.collection('progress').findOne({playerId:id}),saveIfUnchanged:async(p,stamp)=>{if(failCas-->0)return false;return (await db.collection('progress').updateOne({playerId:p.playerId,updatedAt:stamp},{$set:p})).matchedCount===1;}};
 const sc={progressRepository:progress,itemRepository:{findById:id=>db.collection('items').findOne({id}),findAll:()=>db.collection('items').find().toArray()},rewardService:{grantCurrency:x=>currency.grantCurrencyAtomic({...x,playerId:x.discordId})}};
 const rows=new Map(),def=require('./migrate-autumn-quests').definitions().find(q=>q.id===QUEST_ID);
 const repo={listQuests:async()=>[def],getPlayerProgress:async(id,period)=>structuredClone(rows.get(id+period)||{}),savePlayerProgress:async(id,period,p)=>{if(failSave)throw Error('claim-state-write-failed');rows.set(id+period,structuredClone(p));}};
 const qs=new WeeklyQuestService(repo,{getProfile:async id=>({progress:await progress.findByPlayerId(id)})},{...sc,isOpen:()=>false});
 const claim=()=>qs.claimReward('p',QUEST_ID,r=>grantAutumnQuestReward(sc,'p','tester',r));
 const count=async id=>(await progress.findByPlayerId('p')).inventory.filter(i=>i.itemId===id).reduce((a,i)=>a+(i.stackCount||1),0);
 try{
  await db.collection('items').insertMany([titleItem,...questPatch.rewardItems.filter(r=>r.itemId!==TITLE_ID).map(r=>({id:r.itemId,name:r.itemId,itemType:'consumable'}))]);
  await db.collection('progress').insertOne({playerId:'p',level:29,equipment:{},inventory:[],updatedAt:'2026-10-01T00:00:00.000Z'});
  await db.collection('wallets').insertOne({playerId:'p',gold:0,diamond:0});
  await assert.rejects(claim,/未解鎖/);
  await db.collection('progress').updateOne({playerId:'p'},{$set:{level:30}});
  await qs.recordProgressBatch('p',{party_floor_clear:19},{operationId:'floor-19'});
  await assert.rejects(claim,/未完成/);
  await qs.recordProgressBatch('p',{party_floor_clear:1},{operationId:'floor-20'});
  await qs.recordProgressBatch('p',{party_floor_clear:1},{operationId:'floor-20'});
  failCas=2;failSave=true;await assert.rejects(claim,/claim-state-write-failed/);failSave=false;
  assert.equal(await count(TITLE_ID),1);
  const concurrent=await Promise.allSettled(Array.from({length:8},claim));assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.collection('wallets').findOne({playerId:'p'})).gold,12000);assert.equal(await count(TITLE_ID),1);
  assert.equal(await count(questPatch.rewardItems[0].itemId),5);
  // A new weekly receipt gives gems and gold again, but never the title again.
  const reward={receipt:'quest:next-week:p',gold:12000,exp:0,rewardItems:questPatch.rewardItems};
  await grantAutumnQuestReward(sc,'p','tester',reward);await grantAutumnQuestReward(sc,'p','tester',reward);
  assert.equal(await count(TITLE_ID),1);assert.equal(await count(questPatch.rewardItems[0].itemId),10);assert.equal(await count(questPatch.rewardItems[1].itemId),4);
  assert.equal((await db.collection('wallets').findOne({playerId:'p'})).gold,24000);
  // Legacy ownership on another character also prevents duplication and records lifetime receipt.
  let p=await progress.findByPlayerId('p');const title=p.inventory.find(i=>i.itemId===TITLE_ID);
  await db.collection('progress').updateOne({playerId:'p'},{$set:{inventory:p.inventory.filter(i=>i.itemId!==TITLE_ID),characterSlots:{2:{equipment:{title_eq:title}}},questOnceItemReceipts:[]}});
  await grantAutumnQuestReward(sc,'p','tester',{...reward,receipt:'quest:third-week:p'});assert.equal(await count(TITLE_ID),0);
  p=await progress.findByPlayerId('p');assert(p.questOnceItemReceipts.includes(TITLE_ID));
  const update=require('../src/services/admin/seasonResetPolicy').buildProgressResetUpdate({...p,inventory:[title]});
  assert(update.$set.inventory.some(i=>i.itemId===TITLE_ID));assert(!Object.hasOwn(update.$unset||{},'questOnceItemReceipts'));
  const gold=(await db.collection('wallets').findOne({playerId:'p'})).gold;
  await assert.rejects(()=>grantAutumnQuestReward(sc,'p','tester',{...reward,receipt:'bad',rewardItems:[{itemId:'missing',qty:1}]}),/不存在/);
  assert.equal((await db.collection('wallets').findOne({playerId:'p'})).gold,gold);
  console.log('PASS level 29/30, floors 19/20, repeated progress, CAS retries, interrupted claim, concurrent claims, weekly renewal, cross-character title, seasonal retention, missing-item atomic guard');
 }finally{await client.close();await server.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
