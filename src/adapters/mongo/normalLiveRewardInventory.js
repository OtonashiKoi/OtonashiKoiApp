"use strict";
const {normalizeEnhanceGemStacks}=require("../../shared/inventoryStacking");
const {slimInventoryArray,normalizeInventoryEntryMongoId}=require("../../shared/inventoryStorage");
const seasonState=require("../../services/access/seasonStateStore");
const maintenance=require("../../services/access/maintenanceStore");

function createNormalLiveRewardInventory({collection,normalizeLowLevelJobBadge,emitRealtimeInvalidate}) {
  const {createProgressReceiptLedger,epochFilter,nextTime}=require("./progressReceiptLedger");
  const ledger=createProgressReceiptLedger(collection);
  const receiptStore=require("./liveDropReceiptStore").createLiveDropReceiptStore(collection);
  return {
      async findExpRewardProgress(playerId, operationId = null) {
        await ledger.ensure(playerId);
        const doc=await (await collection("progress")).findOne(seasonState.progressFilter(playerId), {
          projection: {playerId:1,seasonKey:1,activeCharacterSlot:1,updatedAt:1,receiptEpoch:1,level:1,exp:1,
            attributes:1,statusPoints:1,levelUpHistory:1,levelReachedAt:1,levelStartedAt:1,
            expGrantReceipts:operationId?{$filter:{input:{$ifNull:['$expGrantReceipts',[]]},as:'receipt',cond:{$eq:['$$receipt',{$literal:operationId}]}}}:1,
            normalLiveExpResults:operationId?{$filter:{input:{$ifNull:['$normalLiveExpResults',[]]},as:'receipt',cond:{$eq:['$$receipt.id',{$literal:operationId}]}}}:1}
        });
        if(doc&&operationId){
          const season=doc.seasonKey||seasonState.LEGACY_KEY;
          const [receipts,results]=await Promise.all([ledger.lookup(playerId,season,'expGrantReceipts',[operationId]),ledger.lookup(playerId,season,'normalLiveExpResults',[operationId])]);
          doc.expGrantReceipts=[...new Set([...(doc.expGrantReceipts||[]),...receipts])];
          doc.normalLiveExpResults=[...(doc.normalLiveExpResults||[]),...results];
        }
        return doc?{...doc,seasonKey:doc.seasonKey||seasonState.LEGACY_KEY}:null;
      },
      async saveExpRewardIfUnchanged(progress,prevUpdatedAt,operationId = null) {
        if(maintenance.isStrict())throw new Error("SEASON_RESET_WRITE_LOCKED");
        const fields={};
        for(const key of ["level","exp","attributes","statusPoints","levelUpHistory","levelReachedAt","levelStartedAt","expGrantReceipts","normalLiveExpResults"]){
          if(operationId&&["expGrantReceipts","normalLiveExpResults"].includes(key))continue;
          if(Object.hasOwn(progress,key))fields[key]=progress[key];
        }
        // A projected reward snapshot must never overwrite inventory/equipment.
        // Even retries only write EXP-owned fields and keep the season/slot guard.
        const result=await (await collection("progress")).updateOne({
          ...seasonState.progressFilter(progress.playerId,progress.seasonKey),
          ...epochFilter(progress),
          updatedAt:prevUpdatedAt===undefined?{$exists:false}:prevUpdatedAt,
          activeCharacterSlot:progress.activeCharacterSlot===undefined?{$exists:false}:progress.activeCharacterSlot,
          ...(operationId?{expGrantReceipts:{$ne:operationId}}:{})
        },{$set:{...fields,updatedAt:progress.updatedAt},...(operationId?{
          $addToSet:{expGrantReceipts:operationId},
          $push:{normalLiveExpResults:progress.normalLiveExpResults.find(r=>r.id===operationId)}
        }:{})},{upsert:false});
        if(result.matchedCount)require("../../services/realtime/playerEventBus").playerEventBus.invalidateProfile(progress.playerId,"exp_reward");
        return result.matchedCount>0;
      },
      async findRewardProgressByPlayerIds(playerIds) {
        const ids = [...new Set(playerIds.map(String))];
        if (!ids.length) return [];
        // Reward conditions inspect inventory IDs only. Do not load every
        // portrait/effect/receipt or merge the same equipment library per player.
        const docs = await (await collection("progress")).find({ playerId: { $in: ids } }, {
          projection: { playerId: 1, seasonKey: 1, activeCharacterSlot: 1, level: 1,
            attributes: 1, equipment: 1, activeEffects: 1, "inventory.itemId": 1 }
        }).toArray();
        return docs.map(doc => ({ ...normalizeLowLevelJobBadge(doc), seasonKey: doc.seasonKey || seasonState.LEGACY_KEY }));
      },
      async grantInventoryRewardsBatch(grants) {
        if (maintenance.isStrict()) throw new Error("SEASON_RESET_WRITE_LOCKED");
        if (!grants.length) return {};
        const col = await collection("progress");
        const plannedGrants=await receiptStore.prepare(grants);
        const ids = [...new Set(grants.map(g => String(g.playerId)))];
        for(const pid of ids)await ledger.ensure(pid,plannedGrants.find(g=>g.playerId===pid).seasonKey||seasonState.getActiveKey());
        let docs,receipts;
        for(let attempt=0;attempt<12;attempt++){
          const states=await col.find({playerId:{$in:ids}},{projection:{playerId:1,seasonKey:1,receiptEpoch:1,updatedAt:1}}).toArray();
          const operations=[];
          for(const {playerId,id,entries,seasonKey} of plannedGrants){
            if(!playerId||!id||!Array.isArray(entries))throw Error('Invalid inventory reward');
            const season=seasonKey||seasonState.getActiveKey(),state=states.find(d=>d.playerId===playerId);
            if(!state||(state.seasonKey||seasonState.LEGACY_KEY)!==season)throw Error('Inventory reward was not committed: character season changed');
            if((await ledger.lookup(playerId,season,'normalLiveDropReceipts',[id])).length)continue;
            operations.push({updateOne:{filter:{...seasonState.progressFilter(playerId,season),...epochFilter(state),'normalLiveDropReceipts.id':{$ne:id}},update:{$push:{inventory:{$each:slimInventoryArray(normalizeEnhanceGemStacks(entries.map(normalizeInventoryEntryMongoId)))},normalLiveDropReceipts:{id}},$set:{updatedAt:nextTime(state)}},upsert:false}});
          }
          try{if(operations.length)await col.bulkWrite(operations,{ordered:false});}
          catch(error){
            if(error.code!==17419&&!error.writeErrors?.some(e=>e.code===17419))throw error;
            await receiptStore.compact(ids);
          }
          docs=await col.aggregate([{$match:{playerId:{$in:ids}}},{$project:{playerId:1,seasonKey:1,normalLiveDropReceipts:{$filter:{input:{$ifNull:['$normalLiveDropReceipts',[]]},as:'receipt',cond:{$in:['$$receipt.id',{$literal:grants.map(g=>g.id)}]}}}}}]).toArray();
          for(const doc of docs)doc.normalLiveDropReceipts.push(...await ledger.lookup(doc.playerId,doc.seasonKey||seasonState.LEGACY_KEY,'normalLiveDropReceipts',grants.filter(g=>g.playerId===doc.playerId).map(g=>g.id)));
          receipts=await receiptStore.read(docs);
          if(grants.every(g=>Object.hasOwn(receipts[g.playerId]||{},g.id)))break;
        }
        for (const doc of docs) {
          emitRealtimeInvalidate("progress", doc.playerId);
        }
        for (const grant of grants) {
          if (!Object.hasOwn(receipts[grant.playerId] || {}, grant.id)) throw new Error("Inventory reward was not committed");
        }
        return receipts;
      },
  };
}
module.exports={createNormalLiveRewardInventory};
