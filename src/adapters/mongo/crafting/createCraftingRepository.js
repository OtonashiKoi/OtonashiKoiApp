"use strict";

const { getMongoDb, withMongoTransaction, supportsMongoTransactions } = require("../createMongoClient");
const { slimInventoryArray } = require("../../../shared/inventoryStorage");
const seasonState = require("../../../services/access/seasonStateStore");
const maintenance = require("../../../services/access/maintenanceStore");
const {
  acquireCraftingLock,
  releaseCraftingLock,
  recoverCraftingOperations,
  executeStandaloneCraft
} = require("./craftingOperationJournal");

function createCraftingRepository({ emitRealtimeInvalidate = () => {} } = {}) {
  return {
    async listAccessible(discordId) {
      const db = await getMongoDb();
      const id = String(discordId || "").trim();
      return db.collection("craftingRecipes")
        .find({
          enabled: true,
          $or: [{ accessMode: "public" }, { accessMode: "owner_test", testerIds: id }]
        })
        .sort({ sortOrder: 1, id: 1 })
        .toArray();
    },

    async findRecipeById(id) {
      const db = await getMongoDb();
      return db.collection("craftingRecipes").findOne({ id: String(id || "") }) || null;
    },

    async saveRecipe(recipe) {
      const db = await getMongoDb();
      await db.collection("craftingRecipes").updateOne(
        { id: recipe.id },
        { $set: recipe },
        { upsert: true }
      );
      return recipe;
    },

    async disableRecipes(ids, reason = "replaced") {
      const recipeIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
      if (recipeIds.length === 0) return { matchedCount: 0, modifiedCount: 0 };
      const db = await getMongoDb();
      return db.collection("craftingRecipes").updateMany(
        { id: { $in: recipeIds } },
        { $set: { enabled: false, disabledReason: reason, updatedAt: new Date().toISOString() } }
      );
    },

    async executeCraftAtomic({
      playerId,
      expectedSeasonKey,
      expectedUpdatedAt,
      nextInventory,
      goldCost,
      transaction
    }) {
      if (maintenance.isStrict()) {
        const error = new Error("SEASON_RESET_WRITE_LOCKED");
        error.code = "SEASON_RESET_WRITE_LOCKED";
        throw error;
      }

      const safeGoldCost = Math.max(0, Math.trunc(Number(goldCost) || 0));
      const db = await getMongoDb();
      const lockToken = await acquireCraftingLock(db, playerId);
      if (!lockToken) return { ok: false, reason: "progress_conflict" };

      let result;
      try {
        await recoverCraftingOperations(db, playerId);
        if (await supportsMongoTransactions()) {
          const now = new Date().toISOString();
          result = await withMongoTransaction(async (txDb, session) => {
            const progressFilter = {
              ...seasonState.progressFilter(playerId, expectedSeasonKey),
              ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
            };
            const progressWrite = await txDb.collection("progress").updateOne(
              progressFilter,
              { $set: { inventory: slimInventoryArray(nextInventory), updatedAt: now } },
              { session }
            );
            if (progressWrite.matchedCount === 0) return { ok: false, reason: "progress_conflict" };

            let wallet = null;
            if (safeGoldCost > 0) {
              wallet = await txDb.collection("wallets").findOneAndUpdate(
                { playerId, gold: { $gte: safeGoldCost } },
                { $inc: { gold: -safeGoldCost }, $set: { updatedAt: now } },
                { session, returnDocument: "after" }
              );
              if (!wallet) {
                const error = new Error("INSUFFICIENT_CRAFTING_GOLD");
                error.code = "INSUFFICIENT_CRAFTING_GOLD";
                throw error;
              }
            } else {
              wallet = await txDb.collection("wallets").findOne({ playerId }, { session });
            }
            await txDb.collection("craftingTransactions").insertOne(
              { ...transaction, playerId, goldCost: safeGoldCost, createdAt: now },
              { session }
            );
            return { ok: true, wallet };
          });
        } else {
          result = await executeStandaloneCraft({
            db,
            playerId,
            expectedSeasonKey,
            expectedUpdatedAt,
            nextInventory,
            safeGoldCost,
            transaction
          });
        }
      } finally {
        await releaseCraftingLock(db, playerId, lockToken);
      }

      if (result?.ok) {
        emitRealtimeInvalidate("progress", playerId);
        if (safeGoldCost > 0) emitRealtimeInvalidate("wallet", playerId);
      }
      return result;
    },

    async listPlayerTransactions(playerId, limit = 20) {
      const db = await getMongoDb();
      return db.collection("craftingTransactions")
        .find({ playerId: String(playerId || "") })
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(100, Number(limit) || 20)))
        .toArray();
    }
  };
}

module.exports = { createCraftingRepository };
