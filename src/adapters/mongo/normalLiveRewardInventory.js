"use strict";
const {normalizeEnhanceGemStacks}=require("../../shared/inventoryStacking");
const {slimInventoryArray,normalizeInventoryEntryMongoId}=require("../../shared/inventoryStorage");
const seasonState=require("../../services/access/seasonStateStore");
const maintenance=require("../../services/access/maintenanceStore");

function createNormalLiveRewardInventory({collection,normalizeLowLevelJobBadge,emitRealtimeInvalidate}) {
  return {
      async findExpRewardProgress(playerId, operationId = null) {
        const doc=await (await collection("progress")).findOne(seasonState.progressFilter(playerId), {
          projection: {playerId:1,seasonKey:1,activeCharacterSlot:1,updatedAt:1,level:1,exp:1,
            attributes:1,statusPoints:1,levelUpHistory:1,levelReachedAt:1,levelStartedAt:1,
            expGrantReceipts:operationId?{$filter:{input:{$ifNull:['$expGrantReceipts',[]]},as:'receipt',cond:{$eq:['$$receipt',{$literal:operationId}]}}}:1,
            normalLiveExpResults:operationId?{$filter:{input:{$ifNull:['$normalLiveExpResults',[]]},as:'receipt',cond:{$eq:['$$receipt.id',{$literal:operationId}]}}}:1}
        });
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
        const now = new Date().toISOString();
        const col = await collection("progress");
        const operations = grants.map(({ playerId, id, entries, seasonKey }) => {
          if (!playerId || !id || !Array.isArray(entries)) throw new Error("Invalid inventory reward");
          const safeEntries = entries.map(normalizeInventoryEntryMongoId);
          return { updateOne: {
            filter: { ...seasonState.progressFilter(playerId, seasonKey || seasonState.getActiveKey()), "normalLiveDropReceipts.id": { $ne: id } },
            update: { $push: {
              inventory: { $each: slimInventoryArray(normalizeEnhanceGemStacks(safeEntries)) },
              normalLiveDropReceipts: { id, entries: safeEntries }
            }, $set: { updatedAt: now } }, upsert: false
          } };
        });
        // Atomic append + receipt per player: a concurrent bag edit cannot be
        // overwritten, and replaying a partially applied bulk cannot duplicate loot.
        await col.bulkWrite(operations, { ordered: false });
        const ids = [...new Set(grants.map(g => String(g.playerId)))];
        const receiptIds = grants.map(g => g.id);
        const docs = await col.aggregate([
          { $match: { playerId: { $in: ids } } },
          { $project: { playerId: 1, normalLiveDropReceipts: { $filter: {
            input: { $ifNull: ["$normalLiveDropReceipts", []] }, as: "receipt",
            cond: { $in: ["$$receipt.id", { $literal: receiptIds }] }
          } } } }
        ]).toArray();
        const receipts = {};
        for (const doc of docs) {
          receipts[doc.playerId] = Object.fromEntries(doc.normalLiveDropReceipts.map(r => [r.id, r.entries]));
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
