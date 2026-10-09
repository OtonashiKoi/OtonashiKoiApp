'use strict';
require('dotenv').config({quiet:true});
process.env.MONGODB_DB_NAME='qa_receipt_capacity_'+Date.now();
const assert=require('node:assert/strict');
const {getMongoDb}=require('../src/adapters/mongo/createMongoClient');
const {createServiceContext}=require('../src/services/createServiceContext');
const {createProgressReceiptLedger,FIELDS}=require('../src/adapters/mongo/progressReceiptLedger');
(async()=>{
 const db=await getMongoDb();assert.ok(db.databaseName.startsWith('qa_receipt_capacity_'));
 const sc=createServiceContext(),repo=sc.progressRepository,col=db.collection('progress'),pid='qa_receipt_history';
 await sc.playerService.ensurePlayer(pid,pid);await repo.updateFields(pid,{level:10,exp:0});
 const season=(await col.findOne({playerId:pid})).seasonKey;
 const expId='normal-live:historic-exp',dropId='normal-live:historic-drop',sessionId='historic-session';
 await sc.progressService.grantExp({discordId:pid,displayName:pid,amount:20,source:'monster:kill',operationId:expId});
 await repo.grantInventoryRewardsBatch([{playerId:pid,id:dropId,entries:[{uuid:'earned-once',itemId:'qa-item',itemType:'material',stackCount:3}]}]);
 await repo.updateFields(pid,{normalLiveSessionReceipts:[sessionId],shadowGauge:{grids:3}});
 const initial=await col.findOne({playerId:pid}),before={exp:initial.exp,inventory:initial.inventory};
 const values={};for(const f of FIELDS)values[f]=[...(initial[f]||[]),...Array.from({length:300},(_,i)=>f==='normalLiveDropReceipts'?{id:'old-drop-'+i}:f==='normalLiveExpResults'?{id:'old-exp-'+i,levelUps:0}:f==='expGrantReceipts'?'old-exp-'+i:'old-session-'+i)];
 await col.updateOne({playerId:pid},{$set:values});
 const ledger=createProgressReceiptLedger(async n=>db.collection(n));await ledger.compact(pid,season);
 const small=await col.findOne({playerId:pid});for(const f of FIELDS)assert.equal(small[f].length,64);
 assert.deepEqual(small.inventory,before.inventory);assert.equal(small.exp,before.exp);
 const replay=await sc.progressService.grantExp({discordId:pid,displayName:pid,amount:999,source:'monster:kill',operationId:expId});assert.equal(replay.duplicate,true);
 const drops=await repo.grantInventoryRewardsBatch([{playerId:pid,id:dropId,entries:[{uuid:'rerolled',itemId:'wrong'}]}]);assert.equal(drops[pid][dropId][0].uuid,'earned-once');
 assert.ok(await repo.hasLiveSessionReceipt(pid,sessionId));await repo.updateFields(pid,{normalLiveSessionReceipts:[sessionId],shadowGauge:{grids:99}});
 const after=await col.findOne({playerId:pid});assert.equal(after.exp,before.exp);assert.deepEqual(after.inventory,before.inventory);assert.equal(after.shadowGauge.grids,3);
 // A stale generic snapshot cannot restore the migrated arrays or receipt epoch.
 await repo.save(initial);const saved=await col.findOne({playerId:pid});for(const f of FIELDS)assert.equal(saved[f].length,64);assert.equal(saved.receiptEpoch,small.receiptEpoch);
 // Suspend a drop append after it reads epoch N. Relocate that same receipt,
 // then replay: epoch N must not append it a second time after the hot ID moved.
 const staleId=small.normalLiveDropReceipts[0].id;
 await db.collection('normalLiveRewardReceipts').updateOne({playerId:pid,id:staleId},{$set:{entries:[]}},{upsert:true});
 // Seed through the real planner to create its hashed external entry.
 await repo.grantInventoryRewardsBatch([{playerId:pid,id:staleId,entries:[]}]);
 await col.updateOne({playerId:pid},{$push:{normalLiveDropReceipts:{$each:Array.from({length:190},(_,i)=>({id:'race-'+i}))}}});
 const original=col.bulkWrite.bind(col);let injected=false;
 col.bulkWrite=async(ops,options)=>{if(!injected&&ops.some(o=>o.updateOne?.update?.$push?.normalLiveDropReceipts?.id===staleId)){injected=true;await ledger.compact(pid,season,true); }return original(ops,options);};
 // Repository gets the same Collection through a separate wrapper for injection.
 const custom=require('../src/adapters/mongo/normalLiveRewardInventory').createNormalLiveRewardInventory({collection:async n=>n==='progress'?col:db.collection(n),normalizeLowLevelJobBadge:x=>x,emitRealtimeInvalidate:()=>{}});
 await custom.grantInventoryRewardsBatch([{playerId:pid,id:staleId,entries:[{uuid:'must-not-grant',itemId:'wrong'}]}]);assert.ok(injected);
 assert.equal((await col.findOne({playerId:pid})).inventory.some(e=>e.uuid==='must-not-grant'),false);col.bulkWrite=original;
 // Simulated crash after ledger copy, before progress trim remains replay-safe.
 const snap=await col.findOne({playerId:pid});const realUpdate=col.updateOne.bind(col);let failed=false;
 await col.updateOne({playerId:pid},{$push:{normalLiveSessionReceipts:{$each:Array.from({length:260},(_,i)=>'crash-'+i)}}});
 const crashLedger=createProgressReceiptLedger(async n=>n==='progress'?col:db.collection(n));
 col.updateOne=async(f,u,o)=>{if(Array.isArray(u)&&u[0].$set?.receiptEpoch&&!failed){failed=true;throw Error('injected migration crash');}return realUpdate(f,u,o);};
 await assert.rejects(crashLedger.compact(pid,season),/injected migration crash/);col.updateOne=realUpdate;
 await ledger.compact(pid,season);assert.ok(await repo.hasLiveSessionReceipt(pid,'crash-0'));
 // EXP is the first write against a real near-16 MiB legacy document.
 const big='qa_exp_first_at_limit';await sc.playerService.ensurePlayer(big,big);
 const bigDoc=await col.findOne({playerId:big});const entry={id:'big-history',entries:[{itemId:'old',padding:''}]};
 const candidate={...bigDoc,normalLiveDropReceipts:[entry]};
 entry.entries[0].padding='x'.repeat(16777216-require('bson').calculateObjectSize(candidate)-128);
 await col.updateOne({playerId:big},{$set:{normalLiveDropReceipts:[entry]}});
 await sc.progressService.grantExp({discordId:big,displayName:big,amount:1,source:'monster:kill',operationId:'normal-live:exp-first'});
 const bigAfter=await col.findOne({playerId:big});assert.equal(bigAfter.exp,1);assert.ok(require('bson').calculateObjectSize(bigAfter)<1000000);
 assert.deepEqual(bigAfter.inventory,bigDoc.inventory);
 assert.deepEqual((await db.collection('normalLiveRewardReceipts').findOne({playerId:big,id:'big-history'})).entries,entry.entries);
 console.log(JSON.stringify({ok:true,testDb:db.databaseName,checks:['all four receipt arrays bounded','historical EXP and drop replay exactly once','resource replay does not overwrite new state','stale generic save cannot resurrect history','migration versus grant race guarded by epoch','crash after copy recovers without lost receipts','EXP first write near 16 MiB relocates history before overflow']}));process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});
