"use strict";
const {createHash}=require('crypto');
const {serialize}=require('bson');
const seasonState=require('../../services/access/seasonStateStore');
const compacting=new Map();
const key=(pid,season,id)=>createHash('sha256').update(JSON.stringify([pid,season,id])).digest('hex');
const digest=entries=>createHash('sha256').update(serialize({entries})).digest('hex');
function createLiveDropReceiptStore(collection){
  const ledger=()=>collection('normalLiveRewardReceipts');
  async function put(rows){
    if(!rows.length)return;
    await (await ledger()).bulkWrite(rows.map(row=>({updateOne:{filter:{_id:row._id},update:{$setOnInsert:row},upsert:true}})),{ordered:false});
    const saved=await (await ledger()).find({_id:{$in:rows.map(r=>r._id)}}).toArray(),byId=new Map(saved.map(r=>[r._id,r]));
    for(const row of rows)if(!byId.has(row._id))throw Error('Live drop receipt not persisted');
    return byId;
  }
  async function prepare(grants){
    const rows=grants.map(g=>({_id:key(g.playerId,g.seasonKey||seasonState.getActiveKey(),g.id),playerId:g.playerId,seasonKey:g.seasonKey||seasonState.getActiveKey(),id:g.id,entries:g.entries,createdAt:new Date()}));
    const saved=await put(rows);
    return grants.map((g,i)=>({...g,entries:saved.get(rows[i]._id).entries}));
  }
  async function read(docs){
    const wanted=docs.flatMap(d=>(d.normalLiveDropReceipts||[]).filter(r=>!Array.isArray(r.entries)).map(r=>key(d.playerId,d.seasonKey||seasonState.LEGACY_KEY,r.id)));
    const rows=wanted.length?await (await ledger()).find({_id:{$in:wanted}}).toArray():[];
    const byId=new Map(rows.map(r=>[r._id,r.entries]));
    const result={};for(const d of docs)for(const r of d.normalLiveDropReceipts||[]){
      const entries=Array.isArray(r.entries)?r.entries:byId.get(key(d.playerId,d.seasonKey||seasonState.LEGACY_KEY,r.id));
      if(!entries)throw Error('Live drop receipt entries missing');
      (result[d.playerId]||={})[r.id]=entries;
    }
    return result;
  }
  async function compactPlayer(pid){
    const col=await collection('progress');
    for(let attempt=0;attempt<6;attempt++){
      const doc=await col.findOne(seasonState.progressFilter(pid));if(!doc)return;
      const inline=(doc.normalLiveDropReceipts||[]).filter(r=>Array.isArray(r.entries));if(!inline.length)return;
      const season=doc.seasonKey||seasonState.LEGACY_KEY;
      const rows=inline.map(r=>({_id:key(pid,season,r.id),playerId:pid,seasonKey:season,id:r.id,entries:r.entries,createdAt:new Date()}));
      const saved=await put(rows);
      // Verify every historical entry before replacing its embedded duplicate.
      for(const row of rows)if(digest(saved.get(row._id).entries)!==digest(row.entries))throw Error('Live receipt relocation verification failed');
      const result=await col.updateOne({_id:doc._id,updatedAt:doc.updatedAt===undefined?{$exists:false}:doc.updatedAt},{$set:{normalLiveDropReceipts:doc.normalLiveDropReceipts.map(r=>({id:r.id})),updatedAt:new Date().toISOString()}});
      if(result.matchedCount){console.log('[LiveDropReceipts] historical entries preserved in independent ledger:',inline.length);return;}
    }
    throw Error('Live receipt relocation CAS conflict');
  }
  async function compact(pids){
    for(const pid of new Set(pids)){
      if(!compacting.has(pid)){const work=compactPlayer(pid).finally(()=>compacting.delete(pid));compacting.set(pid,work);}
      await compacting.get(pid);
    }
  }
  return {prepare,read,compact};
}
module.exports={createLiveDropReceiptStore};
