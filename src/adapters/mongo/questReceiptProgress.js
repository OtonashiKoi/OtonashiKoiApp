'use strict';
const {createHash}=require('node:crypto');
const META=Symbol('quest-receipt-snapshot');
const key=(identity,id)=>createHash('sha256').update(JSON.stringify([identity.discordId,identity.cadence,identity.periodKey,id])).digest('hex');
const epochFilter=doc=>({receiptEpoch:doc?.receiptEpoch===undefined?{$exists:false}:doc.receiptEpoch});
function createQuestReceiptProgress(collection){
 const pending=new Map();
 async function compact(identity){
  const token=JSON.stringify(identity);if(pending.has(token))return pending.get(token);
  const work=(async()=>{const col=await collection('weeklyQuestProgress'),ledger=await collection('questOperationReceipts');
   for(let attempt=0;attempt<8;attempt++){
    const doc=await col.findOne(identity,{projection:{'progress._partyOperations':1,receiptEpoch:1}}),ids=doc?.progress?._partyOperations||[];
    if(ids.length<=256)return;
    const moved=ids.slice(0,-64);
    for(let i=0;i<moved.length;i+=256){const batch=moved.slice(i,i+256),rows=batch.map(id=>({_id:key(identity,id),...identity,id}));
     await ledger.bulkWrite(rows.map(row=>({updateOne:{filter:{_id:row._id},update:{$setOnInsert:row},upsert:true}})),{ordered:false});
     const saved=new Map((await ledger.find({_id:{$in:rows.map(r=>r._id)}}).toArray()).map(r=>[r._id,r.id]));
     for(const row of rows)if(saved.get(row._id)!==row.id)throw Error('Quest receipt verification failed');
    }
    const result=await col.updateOne({_id:doc._id,...epochFilter(doc),$expr:{$eq:[{$slice:['$progress._partyOperations',moved.length]},{$literal:moved}]}},[{$set:{'progress._partyOperations':{$slice:['$progress._partyOperations',moved.length,{$size:'$progress._partyOperations'}]},receiptEpoch:{$add:[{$ifNull:['$receiptEpoch',0]},1]},updatedAt:new Date().toISOString()}}]);
    if(result.matchedCount)return;
   }
   throw Error('Quest receipt relocation conflict');
  })().finally(()=>pending.delete(token));pending.set(token,work);return work;
 }
 async function getPlayerProgress(discordId,periodKey,cadence='weekly',options={}){
  const identity={discordId,cadence,periodKey},col=await collection('weeklyQuestProgress'),id=options.operationId;
  if(id){const [row]=await col.aggregate([{$match:identity},{$project:{count:{$size:{$ifNull:['$progress._partyOperations',[]]}}}}]).toArray();if(row?.count>256)await compact(identity);}
  let doc=id?(await col.aggregate([{$match:identity},{$set:{'progress._partyOperations':{$filter:{input:{$ifNull:['$progress._partyOperations',[]]},as:'id',cond:{$eq:['$$id',{$literal:id}]}}}}}]).toArray())[0]:await col.findOne(identity,{projection:{'progress._partyOperations':0}});
  if(!doc&&cadence==='weekly')doc=await col.findOne({discordId,weekLabel:periodKey},{projection:id?{}:{'progress._partyOperations':0}});
  const progress=doc?.progress||{};
  if(id){const saved=await (await collection('questOperationReceipts')).findOne({_id:key(identity,id)},{projection:{_id:1}});if(saved)progress._partyOperations=[id];}
  Object.defineProperty(progress,META,{value:doc||{},enumerable:false});return progress;
 }
 async function savePlayerProgress(discordId,periodKey,progress,cadence='weekly',options={}){
  const identity={discordId,cadence,periodKey},id=options.operationId,col=await collection('weeklyQuestProgress');
  const fields={...identity,weekLabel:cadence==='weekly'?periodKey:null,updatedAt:new Date().toISOString()};
  for(const [k,v] of Object.entries(progress))if(k!=='_partyOperations')fields['progress.'+k]=v;
  const snapshot=progress[META]||{};
  if(id&&await (await collection('questOperationReceipts')).findOne({_id:key(identity,id)},{projection:{_id:1}}))return;
  const base=snapshot._id?{_id:snapshot._id,...(snapshot.cadence?identity:{})}:identity;
  const filter={...base,...(id?{...epochFilter(snapshot),'progress._partyOperations':{$ne:id}}:{})};
  const update={$set:fields,...(id?{$push:{'progress._partyOperations':id}}:{})};
  let result;try{result=await col.updateOne(filter,update,{upsert:!snapshot._id});}catch(e){if(id&&e.code===11000)throw Error('Quest receipt state changed; retry settlement');throw e;}
  if(id&&!result.matchedCount&&!result.upsertedCount)throw Error('Quest receipt state changed; retry settlement');
 }
 return {getPlayerProgress,savePlayerProgress,compact};
}
module.exports={createQuestReceiptProgress};
