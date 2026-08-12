"use strict";

const { randomUUID } = require("crypto");
const { slimInventoryArray } = require("../../../shared/inventoryStorage");
const seasonState = require("../../../services/access/seasonStateStore");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireCraftingLock(db, playerId) {
  const token = randomUUID();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = new Date();
    try {
      const row = await db.collection("craftingLocks").findOneAndUpdate(
        {
          _id: String(playerId),
          $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }]
        },
        {
          $set: {
            token,
            leaseUntil: new Date(now.getTime() + 30_000),
            updatedAt: now.toISOString()
          }
        },
        { upsert: true, returnDocument: "after" }
      );
      if (row?.token === token) return token;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    await wait(25 * (attempt + 1));
  }
  return null;
}

async function releaseCraftingLock(db, playerId, token) {
  if (!token) return;
  await db.collection("craftingLocks").deleteOne({ _id: String(playerId), token }).catch(() => {});
}

async function writeCraftingLog(db, operation) {
  const snapshot = operation.transaction || {};
  await db.collection("craftingTransactions").updateOne(
    { id: operation.id },
    {
      $setOnInsert: {
        ...snapshot,
        id: operation.id,
        playerId: operation.playerId,
        goldCost: operation.goldCost,
        createdAt: operation.createdAt
      }
    },
    { upsert: true }
  );
}

/**
 * 單機 MongoDB 不支援跨 collection transaction，因此用 durable operation journal 復原：
 * wallet 扣款與 operation id 同一筆更新；progress 換背包也同時留下 operation id。
 * 重啟後看到 progress marker 代表成品已入袋，否則只退回仍帶 debit marker 的扣款。
 */
async function recoverCraftingOperations(db, playerId) {
  const operations = await db.collection("craftingOperations")
    .find({ playerId: String(playerId), status: { $nin: ["completed", "aborted"] } })
    .sort({ createdAt: 1 })
    .limit(20)
    .toArray();

  for (const operation of operations) {
    const [progress, wallet] = await Promise.all([
      db.collection("progress").findOne(
        { playerId: String(playerId) },
        { projection: { craftingAppliedOperationId: 1 } }
      ),
      db.collection("wallets").findOne(
        { playerId: String(playerId) },
        { projection: { craftingDebitOperationId: 1, gold: 1 } }
      )
    ]);
    const progressApplied = String(progress?.craftingAppliedOperationId || "") === String(operation.id);
    const walletDebited = String(wallet?.craftingDebitOperationId || "") === String(operation.id);
    const recoveredAt = new Date().toISOString();

    if (progressApplied) {
      await writeCraftingLog(db, operation);
      if (walletDebited) {
        await db.collection("wallets").updateOne(
          { playerId: String(playerId), craftingDebitOperationId: operation.id },
          { $unset: { craftingDebitOperationId: "" }, $set: { updatedAt: recoveredAt } }
        );
      }
      await db.collection("craftingOperations").updateOne(
        { id: operation.id },
        { $set: { status: "completed", recoveredAt, updatedAt: recoveredAt } }
      );
      continue;
    }

    if (walletDebited && Number(operation.goldCost) > 0) {
      await db.collection("wallets").updateOne(
        { playerId: String(playerId), craftingDebitOperationId: operation.id },
        {
          $inc: { gold: Math.max(0, Number(operation.goldCost) || 0) },
          $unset: { craftingDebitOperationId: "" },
          $set: { updatedAt: recoveredAt }
        }
      );
    }
    await db.collection("craftingOperations").updateOne(
      { id: operation.id },
      { $set: { status: "aborted", recoveredAt, abortReason: "recovered_before_progress", updatedAt: recoveredAt } }
    );
  }
}

async function executeStandaloneCraft({
  db,
  playerId,
  expectedSeasonKey,
  expectedUpdatedAt,
  nextInventory,
  safeGoldCost,
  transaction
}) {
  const now = new Date().toISOString();
  const operation = {
    id: transaction.id,
    playerId: String(playerId),
    status: "prepared",
    goldCost: safeGoldCost,
    expectedSeasonKey: String(expectedSeasonKey || ""),
    expectedUpdatedAt: expectedUpdatedAt || null,
    transaction,
    createdAt: now,
    updatedAt: now
  };
  await db.collection("craftingOperations").insertOne(operation);

  try {
    let wallet = null;
    if (safeGoldCost > 0) {
      wallet = await db.collection("wallets").findOneAndUpdate(
        { playerId: String(playerId), gold: { $gte: safeGoldCost } },
        {
          $inc: { gold: -safeGoldCost },
          $set: { craftingDebitOperationId: operation.id, updatedAt: now }
        },
        { returnDocument: "after" }
      );
      if (!wallet) {
        await db.collection("craftingOperations").updateOne(
          { id: operation.id },
          { $set: { status: "aborted", abortReason: "insufficient_gold", updatedAt: new Date().toISOString() } }
        );
        const error = new Error("INSUFFICIENT_CRAFTING_GOLD");
        error.code = "INSUFFICIENT_CRAFTING_GOLD";
        throw error;
      }
    } else {
      wallet = await db.collection("wallets").findOne({ playerId: String(playerId) });
    }

    await db.collection("craftingOperations").updateOne(
      { id: operation.id },
      { $set: { status: "gold_debited", updatedAt: new Date().toISOString() } }
    );

    const progressFilter = {
      ...seasonState.progressFilter(playerId, expectedSeasonKey),
      ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {})
    };
    const progressWrite = await db.collection("progress").updateOne(
      progressFilter,
      {
        $set: {
          inventory: slimInventoryArray(nextInventory),
          craftingAppliedOperationId: operation.id,
          updatedAt: new Date().toISOString()
        }
      }
    );
    if (progressWrite.matchedCount === 0) {
      await recoverCraftingOperations(db, playerId);
      return { ok: false, reason: "progress_conflict" };
    }

    await db.collection("craftingOperations").updateOne(
      { id: operation.id },
      { $set: { status: "progress_applied", updatedAt: new Date().toISOString() } }
    );
    await writeCraftingLog(db, operation);
    if (safeGoldCost > 0) {
      await db.collection("wallets").updateOne(
        { playerId: String(playerId), craftingDebitOperationId: operation.id },
        { $unset: { craftingDebitOperationId: "" }, $set: { updatedAt: new Date().toISOString() } }
      );
    }
    await db.collection("craftingOperations").updateOne(
      { id: operation.id },
      { $set: { status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
    );
    return { ok: true, wallet };
  } catch (error) {
    if (error?.code === "INSUFFICIENT_CRAFTING_GOLD") throw error;
    await recoverCraftingOperations(db, playerId).catch(() => {});
    const recovered = await db.collection("craftingOperations").findOne({ id: operation.id });
    if (recovered?.status === "completed") {
      const wallet = await db.collection("wallets").findOne({ playerId: String(playerId) });
      return { ok: true, wallet, recovered: true };
    }
    throw error;
  }
}

module.exports = {
  acquireCraftingLock,
  releaseCraftingLock,
  recoverCraftingOperations,
  executeStandaloneCraft
};
