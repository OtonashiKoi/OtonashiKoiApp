"use strict";
const {createHash}=require('node:crypto');
const {serialize}=require('bson');
const seasonState=require('../../services/access/seasonStateStore');
const FIELDS=['expGrantReceipts','normalLiveExpResults','normalLiveDropReceipts','normalLiveSessionReceipts'];
const KEEP=64, LIMIT=256;
const idOf=value=>typeof value==='string'?value:value.id;
const key=(pid,season,field,id)=>createHash('sha256').update(JSON.stringify([pid,season,field,id])).digest('hex');
const epochFilter=doc=>({receiptEpoch:doc.receiptEpoch===undefined?{$exists:false}:doc.receiptEpoch});
const nextTime=doc=>new Date(Math.max(Date.now(),(Date.parse(doc.updatedAt)||0)+1)).toISOString();
function omitReceipts(doc){const result={...doc};for(const field of [...FIELDS,'receiptEpoch'])delete result[field];return result;}
function createProgressReceiptLedger(collection){
  const moving=new Map();
  async function lookup(pid,season,field,ids){
    if(!ids.length)return [];
    return (await (await collection('progressReceipts')).find({_id:{$in:ids.map(id=>key(pid,season,field,id))}},{projection:{value:1}}).toArray()).map(r=>r.value);
  }
  async function compact(pid,season=seasonState.getActiveKey(),force=false){
    const token=JSON.stringify([pid,season]);
    if(moving.has(token))return moving.get(token);
    const work=(async()=>{
      const col=await collection('progress');
      for(let attempt=0;attempt<12;attempt++){
        const doc=await col.findOne(seasonState.progressFilter(pid,season),{projection:Object.fromEntries([...FIELDS,'playerId','seasonKey','updatedAt','receiptEpoch'].map(k=>[k,1]))});
        if(!doc)return;
        const targets=FIELDS.filter(f=>(doc[f]||[]).length>(force?KEEP:LIMIT));
        if(!targets.length)return;
        const rows=targets.flatMap(field=>doc[field].slice(0,-KEEP).map(value=>({_id:key(pid,season,field,idOf(value)),playerId:pid,seasonKey:season,field,value})));
        // Only already committed receipts enter this ledger. Persist and verify
        // before the single-document CAS moves them out of the hot player state.
        const ledger=await collection('progressReceipts');
        for(let i=0;i<rows.length;i+=256){
          const batch=rows.slice(i,i+256);
          await ledger.bulkWrite(batch.map(row=>({updateOne:{filter:{_id:row._id},update:{$setOnInsert:row},upsert:true}})),{ordered:false});
          const saved=new Map((await ledger.find({_id:{$in:batch.map(r=>r._id)}}).toArray()).map(r=>[r._id,r]));
          for(const row of batch)if(!saved.has(row._id)||!serialize({value:row.value}).equals(serialize({value:saved.get(row._id).value})))throw Error('Progress receipt relocation verification failed');
        }
        const lengths=Object.fromEntries(targets.map(f=>[f,doc[f].length-KEEP]));
        const filter={_id:doc._id,...epochFilter(doc),$expr:{$and:targets.map(f=>({$eq:[{$slice:['$'+f,lengths[f]]},{$literal:doc[f].slice(0,lengths[f])}]}))}};
        // Preserve new receipts appended during the copy; only the verified prefix
        // moves. A season reset or other relocation changes the prefix/epoch.
        const result=await col.updateOne(filter,[{$set:{
          ...Object.fromEntries(targets.map(f=>[f,{$slice:['$'+f,lengths[f],{$size:'$'+f}]}])),
          receiptEpoch:{$add:[{$ifNull:['$receiptEpoch',0]},1]},
          updatedAt:{$dateToString:{date:{$add:[{$max:['$$NOW',{$convert:{input:'$updatedAt',to:'date',onError:new Date(0),onNull:new Date(0)}}]},1]},format:'%Y-%m-%dT%H:%M:%S.%LZ'}}
        }}]);
        if(result.matchedCount)return;
      }
      throw Error('Progress receipt relocation conflict');
    })().finally(()=>moving.delete(token));
    moving.set(token,work);return work;
  }
  async function ensure(pid,season=seasonState.getActiveKey()){
    const rows=await (await collection('progress')).aggregate([{$match:seasonState.progressFilter(pid,season)},{$project:{_id:0,bytes:{$bsonSize:'$$ROOT'},counts:FIELDS.map(f=>({$size:{$ifNull:['$'+f,[]]}}))}}]).toArray();
    const row=rows[0];if(row&&(row.counts.some(n=>n>LIMIT)||row.bytes>4*1024*1024)){
      // Legacy drop details already have an immutable, separately keyed store.
      await require('./liveDropReceiptStore').createLiveDropReceiptStore(collection).compact([pid]);
      await compact(pid,season);
    }
  }
  async function sessionSeen(pid,id,season=seasonState.getActiveKey()){
    const col=await collection('progress');
    if(await col.findOne({...seasonState.progressFilter(pid,season),normalLiveSessionReceipts:id},{projection:{_id:1}}))return true;
    return (await lookup(pid,season,'normalLiveSessionReceipts',[id])).length>0;
  }
  async function commitSession(pid,id,fields,season=seasonState.getActiveKey()){
    await ensure(pid,season);const col=await collection('progress');
    for(let attempt=0;attempt<12;attempt++){
      const doc=await col.findOne(seasonState.progressFilter(pid,season),{projection:{receiptEpoch:1,updatedAt:1}});if(!doc)return false;
      if(await sessionSeen(pid,id,season))return true;
      const result=await col.updateOne({...seasonState.progressFilter(pid,season),...epochFilter(doc),normalLiveSessionReceipts:{$ne:id}},{$set:{...omitReceipts(fields),updatedAt:nextTime(doc)},$push:{normalLiveSessionReceipts:id}});
      if(result.matchedCount)return true;
    }
    throw Error('Live session receipt conflict');
  }
  return {lookup,compact,ensure,sessionSeen,commitSession};
}
module.exports={createProgressReceiptLedger,FIELDS,epochFilter,nextTime,omitReceipts};
