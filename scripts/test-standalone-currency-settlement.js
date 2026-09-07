"use strict";
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const { createStandaloneCurrencySettlement } = require("../src/adapters/mongo/standaloneCurrencySettlement");

async function main() {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db("standalone_settlement_test");
  const input = { playerId: "p", currencyType: "gold", amount: 10, source: "monster:kill", sourceRef: "same-op" };
  const repository = createStandaloneCurrencySettlement({ getDb: async () => db });
  try {
    await db.collection("wallets").createIndex({ playerId: 1 }, { unique: true });
    await db.collection("wallets").insertMany([{ playerId: "p", gold: 100, diamond: 0 }, { playerId: "q", gold: 100, diamond: 0 }]);
    const same = await Promise.all(Array.from({ length: 30 }, () => repository.grantCurrencyAtomic(input)));
    assert.equal(same.filter(r => !r.duplicated).length, 1);
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 110);
    await assert.rejects(() => repository.grantCurrencyAtomic({ ...input, playerId: "q" }), e => e.code === "IDEMPOTENCY_CONFLICT");
    await assert.rejects(() => repository.grantCurrencyAtomic({ ...input, amount: 20 }), e => e.code === "IDEMPOTENCY_CONFLICT");
    await Promise.all(Array.from({ length: 20 }, (_, i) => repository.grantCurrencyAtomic({ ...input, sourceRef: `different-${i}` })));
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 310);
    for (const stage of ["after-wallet", "after-ledger", "after-journal"]) {
      let inject = true;
      const broken = createStandaloneCurrencySettlement({ getDb: async () => db, fault: async current => {
        if (inject && current === stage) { inject = false; throw Error(`crash-${stage}`); }
      } });
      const before = (await db.collection("wallets").findOne({ playerId: "p" })).gold;
      await assert.rejects(() => broken.grantCurrencyAtomic({ ...input, sourceRef: stage }), /crash-/);
      // New repository instance simulates restart with no in-memory state.
      const fresh = createStandaloneCurrencySettlement({ getDb: async () => db });
      await fresh.recoverPending();
      await fresh.grantCurrencyAtomic({ ...input, sourceRef: stage });
      const wallet = await db.collection("wallets").findOne({ playerId: "p" });
      assert.equal(wallet.gold, before + 10);
      assert.equal(wallet._currencySettlement, undefined);
      assert.equal(await db.collection("transactions").countDocuments({ sourceRef: stage }), 1);
    }
    const debits = await Promise.allSettled([1, 2].map(i => repository.grantCurrencyAtomic({ ...input, amount: -300, sourceRef: `debit-${i}` })));
    assert.equal(debits.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 40);
    await db.collection("transactions").insertOne({ ...input, sourceRef: "legacy", balanceAfter: 40 });
    await assert.rejects(() => repository.grantCurrencyAtomic({ ...input, sourceRef: "legacy", amount: 999 }), e => e.code === "IDEMPOTENCY_CONFLICT");
    await repository.grantCurrencyAtomic({ ...input, sourceRef: "legacy" });
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 40);
    await repository.grantCurrencyAtomic({ ...input, sourceRef: "" });
    await repository.grantCurrencyAtomic({ ...input, sourceRef: "" });
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 60);
    assert.equal(await db.collection("currencyOperations").countDocuments({ status: "pending" }), 0);
    const interrupted = createStandaloneCurrencySettlement({ getDb: async () => db, fault: async stage => { if (stage === "before-wallet") throw Error("before-apply"); } });
    await assert.rejects(() => interrupted.grantCurrencyAtomic({ ...input, sourceRef: "old-season" }), /before-apply/);
    await db.collection("wallets").updateOne({ playerId: "p" }, { $set: { gold: 0, seasonKey: "new-season" } });
    await repository.recoverPending();
    await assert.rejects(() => repository.grantCurrencyAtomic({ ...input, sourceRef: "old-season" }), e => e.code === "STALE_SEASON_WRITE");
    assert.equal((await db.collection("wallets").findOne({ playerId: "p" })).gold, 0);
    console.log("PASS: standalone 30 concurrent retries, 20 independent rewards, 3 crash recovery stages, double spend rejection, legacy records and no-ref operations");
  } finally { await client.close(); await mongo.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
