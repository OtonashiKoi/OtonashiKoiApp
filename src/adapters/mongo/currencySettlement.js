"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { createTransactionLog } = require("../../domain/transaction/createTransactionLog");
const { AppError, ERROR_CODES } = require("../../shared/errors");

function assertSameOperation(existing, input) {
  if (existing.playerId !== input.playerId || existing.currencyType !== input.currencyType
    || existing.amount !== input.amount) {
    throw new AppError("IDEMPOTENCY_CONFLICT", "此交易編號已用於不同的金額、幣別或玩家。", 409);
  }
}

// The transaction runner owns commit/retry. Never publish notifications inside it.
function createCurrencySettlement({ withTransaction, isStrict = () => false, onCommitted = () => {} }) {
  return async function grantCurrencyAtomic(input) {
    const { playerId, currencyType, amount, source, sourceRef = "", operator } = input;
    const id = sourceRef
      ? `currency:${createHash("sha256").update(JSON.stringify([source, sourceRef])).digest("hex")}`
      : `currency:${randomUUID()}`;
    let result;
    try { result = await withTransaction(async (db, session) => {
      const options = { session };
      const logs = db.collection("transactions");
      const wallets = db.collection("wallets");
      // Retain compatibility with pre-migration donation and reward records.
      const existing = sourceRef
        ? await logs.findOne({ source, sourceRef }, options)
        : await logs.findOne({ _id: id }, options);
      if (existing) {
        assertSameOperation(existing, input);
        return { wallet: await wallets.findOne({ playerId }, options), transaction: existing, duplicated: true };
      }
      if (currencyType === "gold" && isStrict()) {
        throw new AppError("SEASON_RESET_WRITE_LOCKED", "賽季維護中，暫停金幣異動。", 503);
      }
      const filter = amount < 0 ? { playerId, [currencyType]: { $gte: -amount } } : { playerId };
      const wallet = await wallets.findOneAndUpdate(filter, {
        $inc: { [currencyType]: amount }, $set: { updatedAt: new Date().toISOString() }
      }, { ...options, returnDocument: "after" });
      if (!wallet) {
        throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, `${currencyType} balance is not enough`, 400);
      }
      const transaction = { _id: id, ...createTransactionLog({
        playerId, currencyType, amount, source, sourceRef, operator,
        direction: amount > 0 ? "credit" : "debit", balanceAfter: wallet[currencyType]
      }) };
      await logs.insertOne(transaction, options);
      return { wallet, transaction, duplicated: false };
    }); } catch (error) {
      if (error.code !== 11000) throw error;
      // Two different wallets can race for the same external operation id.
      // The losing transaction was aborted; resolve against the committed winner.
      result = await withTransaction(async (db, session) => {
        const existing = await db.collection("transactions").findOne(
          sourceRef ? { source, sourceRef } : { _id: id }, { session });
        if (!existing) throw error;
        assertSameOperation(existing, input);
        return { wallet: await db.collection("wallets").findOne({ playerId }, { session }), transaction: existing, duplicated: true };
      });
    }
    // A failed notification cannot turn a committed payment into a failed request.
    try { onCommitted(playerId); } catch (_) { /* clients also refresh authoritative state */ }
    return result;
  };
}

module.exports = { createCurrencySettlement, assertSameOperation };
