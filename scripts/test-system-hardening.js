"use strict";
const assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const { createCurrencySettlement } = require("../src/adapters/mongo/currencySettlement");
const { acquireRuntimeLease } = require("../src/services/runtime/runtimeLease");

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db("system_hardening_test");
  let notices = 0;
  const withTransaction = async work => {
    const session = client.startSession();
    try { return await session.withTransaction(() => work(db, session)); }
    finally { await session.endSession(); }
  };
  const settle = createCurrencySettlement({ withTransaction, onCommitted: () => notices++ });
  const input = { playerId: "p", currencyType: "gold", amount: 10, source: "monster:kill", sourceRef: "round-unique-p" };
  try {
    await db.collection("wallets").createIndex({ playerId: 1 }, { unique: true });
    await db.collection("wallets").insertMany([{ playerId: "p", gold: 100, diamond: 0 }, { playerId: "q", gold: 100, diamond: 0 }]);
    const results = await Promise.all(Array.from({ length: 12 }, () => settle(input)));
    assert.equal(results.filter(r => !r.duplicated).length, 1);
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 110);
    assert.equal(await db.collection("transactions").countDocuments(), 1);
    assert.equal((await db.collection("transactions").findOne({ sourceRef: input.sourceRef })).expireAt, undefined);
    await assert.rejects(() => settle({ ...input, amount: 11 }), e => e.code === "IDEMPOTENCY_CONFLICT");
    await assert.rejects(() => settle({ ...input, playerId: "q" }), e => e.code === "IDEMPOTENCY_CONFLICT");
    assert.equal((await db.collection("wallets").findOne({ playerId: "q" })).gold, 100);

    const broken = createCurrencySettlement({ withTransaction: work => withTransaction(async (realDb, session) => {
      const proxy = { collection(name) {
        if (name !== "transactions") return realDb.collection(name);
        const logs = realDb.collection(name);
        return { findOne: (...args) => logs.findOne(...args), insertOne() { throw new Error("injected-log-failure"); } };
      } };
      return work(proxy, session);
    }), onCommitted: () => { throw new Error("must not notify"); } });
    const beforeNotices = notices;
    await assert.rejects(() => broken({ ...input, sourceRef: "retry-after-crash" }), /injected-log-failure/);
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 110);
    assert.equal(notices, beforeNotices);
    await settle({ ...input, sourceRef: "retry-after-crash" });
    await settle({ ...input, sourceRef: "retry-after-crash" });
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 120);
    const debits = await Promise.allSettled([1, 2].map(n => settle({ ...input, amount: -100, sourceRef: `spend-${n}` })));
    assert.equal(debits.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 20);
    await settle({ ...input, sourceRef: "" }); await settle({ ...input, sourceRef: "" });
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 40);

    // Existing records remain authoritative during migration.
    await db.collection("transactions").insertOne({ ...input, playerId: "p", sourceRef: "legacy", balanceAfter: 40 });
    assert.equal((await settle({ ...input, sourceRef: "legacy" })).duplicated, true);
    const silent = createCurrencySettlement({ withTransaction, onCommitted() { throw Error("notification down"); } });
    await silent({ ...input, sourceRef: "notice-failure" });
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 50);

    let lost = null;
    const lease = await acquireRuntimeLease(db, { leaseMs: 5000, heartbeatMs: 100, onLost: error => { lost = error; } });
    await assert.rejects(() => acquireRuntimeLease(db), /GAME_RUNTIME_ALREADY_RUNNING/);
    await new Promise(resolve => setTimeout(resolve, 220));
    lease.assertOwned();
    await db.collection("runtimeLeases").updateOne({ _id: "game-runtime" }, { $set: { owner: "replacement" } });
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.ok(lost, "losing ownership must stop the process");
    assert.throws(() => lease.assertOwned(), /LEASE_LOST/);
    await lease.release();
    assert.equal((await db.collection("runtimeLeases").findOne({ _id: "game-runtime" })).owner, "replacement");
    await db.collection("runtimeLeases").updateOne({ _id: "game-runtime" }, { $set: { expiresAt: new Date(0) } });
    const recovered = await acquireRuntimeLease(db);
    await recovered.release();
    console.log("PASS: concurrent rewards, conflict, rollback/retry, no-ref grants, insufficient funds, legacy records, notifications, runtime ownership and recovery");
  } finally { await client.close(); await mongo.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
