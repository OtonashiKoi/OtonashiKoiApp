"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { createTransactionLog } = require("../../domain/transaction/createTransactionLog");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { assertSameOperation } = require("./currencySettlement");
const DURABLE = { writeConcern: { w: "majority", j: true } };

// Standalone Mongo: the balance and its pending ledger entry commit in ONE wallet
// document. A durable operation journal plus a helpable wallet gate lets any retry
// finish ledger delivery. The gate is cleared only after the journal is committed.
function createStandaloneCurrencySettlement({ getDb, isStrict = () => false, onCommitted = () => {}, fault = async () => {}, assertOwned = () => {} }) {
  async function flush(db, wallet) {
    assertOwned();
    const gate = wallet?._currencySettlement;
    if (!gate?.resolved) return;
    if (gate.transaction) {
      await db.collection("transactions", DURABLE).updateOne({ _id: gate.id }, { $setOnInsert: gate.transaction }, { upsert: true });
      await fault("after-ledger");
    }
    await db.collection("currencyOperations", DURABLE).updateOne({ _id: gate.id }, { $set: {
      status: gate.transaction ? "committed" : "rejected", transaction: gate.transaction || null,
      error: gate.transaction ? null : (gate.error || ERROR_CODES.INSUFFICIENT_BALANCE), completedAt: new Date(),
      ...(!gate.sourceRef ? { expireAt: new Date(Date.now() + 3 * 86400000) } : {})
    } });
    await fault("after-journal");
    await db.collection("wallets", DURABLE).updateOne({ playerId: wallet.playerId, "_currencySettlement.id": gate.id, "_currencySettlement.token": gate.token }, { $unset: { _currencySettlement: "" } });
  }
  async function resolveGate(db, wallet) {
    assertOwned();
    const gate = wallet?._currencySettlement;
    if (!gate) return;
    if (gate.resolved) return flush(db, wallet);
    const operation = await db.collection("currencyOperations", DURABLE).findOne({ _id: gate.id });
    if (!operation) throw new Error("Currency operation journal missing; wallet gate preserved");
    if (operation.status !== "pending") {
      await db.collection("wallets", DURABLE).updateOne({ playerId: wallet.playerId, "_currencySettlement.id": gate.id, "_currencySettlement.token": gate.token }, { $unset: { _currencySettlement: "" } });
      return;
    }
    const input = operation.input;
    const { playerId, currencyType, amount, source, sourceRef, operator } = input;
    // A pre-migration record may have a different _id. Recheck AFTER owning the gate.
    const previous = sourceRef ? await db.collection("transactions", DURABLE).findOne({ source, sourceRef }) : null;
    if (previous) {
      try { assertSameOperation(previous, input); }
      catch (error) {
        await db.collection("currencyOperations", DURABLE).updateOne({ _id: gate.id }, { $set: { status: "rejected", error: error.code, completedAt: new Date() } });
        await db.collection("wallets", DURABLE).updateOne({ playerId, "_currencySettlement.id": gate.id, "_currencySettlement.token": gate.token }, { $unset: { _currencySettlement: "" } });
        throw error;
      }
      await db.collection("currencyOperations", DURABLE).updateOne({ _id: gate.id }, { $set: { status: "committed", transaction: previous, completedAt: new Date() } });
      await db.collection("wallets", DURABLE).updateOne({ playerId, "_currencySettlement.id": gate.id, "_currencySettlement.token": gate.token }, { $unset: { _currencySettlement: "" } });
      return;
    }
    const balance = { $ifNull: [`$${currencyType}`, 0] };
    const sameSeason = currencyType !== "gold" ? true
      : { $eq: [{ $ifNull: ["$seasonKey", null] }, { $literal: operation.expectedSeasonKey ?? null }] };
    const allowed = { $and: [sameSeason, amount >= 0 ? true : { $gte: [balance, -amount] }] };
    const nextBalance = { $add: [balance, { $cond: [allowed, amount, 0] }] };
    const log = { _id: gate.id, ...createTransactionLog({ playerId, currencyType, amount, source, sourceRef,
      operator, direction: amount > 0 ? "credit" : "debit", balanceAfter: 0 }) };
    assertOwned();
    await fault("before-wallet");
    const updated = await db.collection("wallets", DURABLE).findOneAndUpdate({ playerId,
      "_currencySettlement.id": gate.id, "_currencySettlement.token": gate.token, "_currencySettlement.resolved": false
    }, [{ $set: {
      [currencyType]: nextBalance, updatedAt: new Date().toISOString(),
      "_currencySettlement.resolved": true,
      "_currencySettlement.error": { $cond: [sameSeason, ERROR_CODES.INSUFFICIENT_BALANCE, "STALE_SEASON_WRITE"] },
      "_currencySettlement.transaction": { $cond: [allowed,
        { $mergeObjects: [{ $literal: log }, { balanceAfter: nextBalance }] }, null] }
    } }], { returnDocument: "after" });
    await fault("after-wallet");
    if (updated) await flush(db, updated);
  }
  async function run(db, id) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      assertOwned();
      const operation = await db.collection("currencyOperations", DURABLE).findOne({ _id: id });
      const wallet = await db.collection("wallets", DURABLE).findOne({ playerId: operation.input.playerId });
      if (operation.status === "committed") {
        if (wallet?._currencySettlement?.id === id) await resolveGate(db, wallet);
        return { wallet: await db.collection("wallets", DURABLE).findOne({ playerId: operation.input.playerId }, { projection: { _currencySettlement: 0 } }), transaction: operation.transaction };
      }
      if (operation.status === "rejected") {
        if (wallet?._currencySettlement?.id === id) await resolveGate(db, wallet);
        throw new AppError(operation.error, operation.error === "STALE_SEASON_WRITE" ? "交易所屬賽季已結束" : operation.error === "IDEMPOTENCY_CONFLICT" ? "交易編號內容不一致" : "餘額不足", operation.error === ERROR_CODES.INSUFFICIENT_BALANCE ? 400 : 409);
      }
      if (!wallet) throw new Error("Currency settlement wallet missing; operation remains pending");
      if (wallet._currencySettlement) { await resolveGate(db, wallet); continue; }
      await db.collection("wallets", DURABLE).updateOne({ playerId: wallet.playerId, _currencySettlement: { $exists: false } }, {
        $set: { _currencySettlement: { id, token: randomUUID(), sourceRef: operation.input.sourceRef || "", resolved: false } }
      });
      // Always re-read the journal after acquiring: an earlier helper may have
      // committed and cleared this same operation between our reads.
    }
    throw new AppError("CURRENCY_SETTLEMENT_PENDING", "交易正在恢復，請使用相同交易編號重試。", 503);
  }
  async function grantCurrencyAtomic(input) {
    const db = await getDb();
    const id = input.sourceRef
      ? `currency:${createHash("sha256").update(JSON.stringify([input.source, input.sourceRef])).digest("hex")}`
      : `currency:${randomUUID()}`;
    const legacy = input.sourceRef ? await db.collection("transactions", DURABLE).findOne({ source: input.source, sourceRef: input.sourceRef }) : null;
    if (legacy) assertSameOperation(legacy, input);
    let inserted = false;
    const existing = await db.collection("currencyOperations", DURABLE).findOne({ _id: id });
    if (!existing && input.currencyType === "gold" && isStrict()) throw new AppError("SEASON_RESET_WRITE_LOCKED", "賽季維護中，暫停金幣異動。", 503);
    const walletAtReservation = await db.collection("wallets", DURABLE).findOne({ playerId: input.playerId }, { projection: { seasonKey: 1 } });
    if (!walletAtReservation) throw new Error("Currency settlement wallet missing");
    try {
      await db.collection("currencyOperations", DURABLE).insertOne({ _id: id, input, expectedSeasonKey: walletAtReservation.seasonKey ?? null, status: "pending", createdAt: new Date() });
      inserted = true;
    } catch (error) { if (error.code !== 11000) throw error; }
    const operation = await db.collection("currencyOperations", DURABLE).findOne({ _id: id });
    assertSameOperation(operation.input, input);
    const result = await run(db, id);
    try { onCommitted(input.playerId); } catch (_) { /* committed data remains authoritative */ }
    return { ...result, duplicated: !inserted || Boolean(legacy) };
  }
  async function recoverPending() {
    const db = await getDb();
    let recovered = 0;
    // Recover gates even if journal commit succeeded just before process failure.
    for await (const wallet of db.collection("wallets", DURABLE).find({ _currencySettlement: { $exists: true } })) await resolveGate(db, wallet);
    for await (const operation of db.collection("currencyOperations", DURABLE).find({ status: "pending" })) {
      try { await run(db, operation._id); recovered++; }
      catch (error) { if (![ERROR_CODES.INSUFFICIENT_BALANCE, "STALE_SEASON_WRITE"].includes(error.code)) throw error; }
    }
    return recovered;
  }
  return { grantCurrencyAtomic, recoverPending };
}
module.exports = { createStandaloneCurrencySettlement };
