"use strict";
function createLiveSettlementRepository(collection) {
  const col=()=>collection('normalLiveSettlements');
  return {
    async create(job) {
      await (await col()).updateOne({_id:job.key},{$setOnInsert:{...job,status:'pending',revision:0,createdAt:new Date()}},{upsert:true});
      return this.find(job.key);
    },
    async find(key){return (await col()).findOne({_id:key});},
    async pending(zone){return (await col()).find({status:'pending',zone}).sort({createdAt:1}).limit(32).toArray();},
    async saveState(key,state,revision){
      const value={...state};delete value.liveSettlementRevision;
      return (await (await col()).updateOne({_id:key,status:'pending',revision},{$set:{state:value},$inc:{revision:1}})).matchedCount===1;
    },
    async handoff(key){await (await col()).updateOne({_id:key},{$set:{handoffComplete:true,handoffAt:new Date()}});},
    async complete(key,rewards){await (await col()).updateOne({_id:key},{$set:{status:'complete',rewards,completedAt:new Date()}});}
  };
}
module.exports={createLiveSettlementRepository};
