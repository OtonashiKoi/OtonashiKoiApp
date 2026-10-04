"use strict";
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = "crafting_public_isolated";
  process.env.JWT_SECRET = "isolated-crafting-test-secret-01234567890123456789";
  const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  const { CraftingService } = require("../src/services/crafting/craftingService");
  const { createCraftingRepository } = require("../src/adapters/mongo/crafting/createCraftingRepository");
  const { executeStandaloneCraft, recoverCraftingOperations } = require("../src/adapters/mongo/crafting/craftingOperationJournal");
  const maintenance = require("../src/services/access/maintenanceStore");
  let server;
  try {
    const db = await getMongoDb();
    await require("../src/services/access/seasonStateStore").activate("s-craft-test");
    await maintenance.setState({ enabled: false, strict: false, activateAt: null, openAt: null });
    const recipe = { id: "public-five-to-one", name: "公開配方", enabled: true, accessMode: "public", testOnly: false,
      inputs: [{ itemId: "material", quantity: 5 }], outputs: [{ itemId: "product", quantity: 1 }], goldCost: 100, maxBatch: 99 };
    await db.collection("craftingRecipes").insertMany([recipe, { ...recipe, id: "private", accessMode: "owner_test", testerIds: [] }]);
    await db.collection("items").insertMany(["material", "product"].map(id => ({ id, name: id, itemType: "consumable" })));
    const player = "ordinary-public-craft";
    const repository = createCraftingRepository();
    const createService = (repo = repository) => new CraftingService({ craftingRepository: repo,
      progressRepository: { findByPlayerId: playerId => db.collection("progress").findOne({ playerId }) },
      walletRepository: { findByPlayerId: playerId => db.collection("wallets").findOne({ playerId }) },
      itemRepository: { findById: id => db.collection("items").findOne({ id }) } });
    const service = createService();
    const reset = async (amount = 20, gold = 1000) => {
      await db.collection("progress").replaceOne({ playerId: player }, { playerId: player, seasonKey: "s-craft-test", updatedAt: "before",
        inventory: [{ uuid: "available", itemId: "material", itemType: "consumable", stackCount: amount },
          { uuid: "locked", itemId: "material", itemType: "consumable", stackCount: 100, locked: true }] }, { upsert: true });
      await db.collection("wallets").replaceOne({ playerId: player }, { playerId: player, gold, diamond: 77 }, { upsert: true });
    };
    const snapshot = async () => ({ progress: await db.collection("progress").findOne({ playerId: player }),
      wallet: await db.collection("wallets").findOne({ playerId: player }) });
    // Production fee bands: batch totals, insufficient funds and retry idempotency.
    for (const fee of new Set(Object.values(require('./apply-crafting-fees').costs))) {
      await db.collection('craftingRecipes').updateOne({ id: recipe.id }, { $set: { goldCost: fee } });
      await reset(15, fee * 2 - 1);
      const beforeFeeFailure = await snapshot();
      await assert.rejects(() => service.craft(player, recipe.id, 2, `fee-fail-${fee}`), e => e.status === 400);
      assert.deepEqual(await snapshot(), beforeFeeFailure);
      await reset(15, fee * 3);
      await service.craft(player, recipe.id, 2, `fee-batch-${fee}`);
      const paid = await snapshot();
      assert.equal(paid.wallet.gold, fee);
      assert.equal(paid.progress.inventory.find(i => i.itemId === 'product').stackCount, 2);
      await service.craft(player, recipe.id, 2, `fee-batch-${fee}`);
      assert.deepEqual(await snapshot(), paid);
    }
    await db.collection('craftingRecipes').updateOne({ id: recipe.id }, { $set: { goldCost: recipe.goldCost } });
    await db.collection('craftingTransactions').deleteMany({ playerId: player });
    await db.collection('craftingOperations').deleteMany({ playerId: player });
    await reset();
    assert.equal((await service.getPlayerState(player)).recipes.length, 1);
    await assert.rejects(() => service.craft(player, "private", 1, "private-request"), e => e.status === 404);
    const unchanged = await snapshot();
    for (const qty of [0, -1, 1.5, 100, NaN, Infinity]) {
      await assert.rejects(() => service.craft(player, recipe.id, qty, "invalid-quantity"), e => e.status === 400);
    }
    assert.deepEqual(await snapshot(), unchanged);
    const results = await Promise.all(Array.from({ length: 10 }, () => service.craft(player, recipe.id, 2, "same-request-0001")));
    assert.equal(new Set(results.map(r => r.transactionId)).size, 1);
    assert.equal(results.filter(r => !r.replayed).length, 1);
    const after = await snapshot();
    assert.equal(after.wallet.gold, 800); assert.equal(after.wallet.diamond, 77);
    assert.equal(after.progress.inventory.find(i => i.uuid === "locked").stackCount, 100);
    assert.equal(after.progress.inventory.find(i => i.itemId === "product").stackCount, 2);
    assert.equal(await db.collection("craftingTransactions").countDocuments({ playerId: player }), 1);
    assert.equal((await createService().craft(player, recipe.id, 2, "same-request-0001")).replayed, true);
    assert.deepEqual(await snapshot(), after);
    await assert.rejects(() => service.craft(player, recipe.id, 1, "same-request-0001"), e => e.status === 409);

    // A CAS conflict must refund, then reuse the request id without a duplicate journal insertion.
    await reset(); let raced = false;
    const conflictService = createService({ ...repository, executeCraftAtomic: async payload => {
      if (!raced) { raced = true; await db.collection("progress").updateOne({ playerId: player }, { $set: { updatedAt: "raced" } }); }
      return repository.executeCraftAtomic(payload);
    } });
    await conflictService.craft(player, recipe.id, 1, "cas-retry-request");
    assert.equal((await snapshot()).wallet.gold, 900);
    assert.equal(await db.collection("craftingTransactions").countDocuments({ playerId: player }), 2);

    // Simulate process interruption after debit and after inventory application, including a failed immediate recovery.
    for (const point of ["before_inventory", "after_inventory"]) {
      await reset(5);
      const { createHash } = require("node:crypto");
      const requestId = `interrupted-${point}`;
      const id = `craft_${createHash("sha256").update(`${player}\0s-craft-test\0${requestId}`).digest("hex")}`;
      let interrupted = false;
      const faultDb = { collection(name) {
        const collection = db.collection(name);
        return new Proxy(collection, { get(target, prop) {
          if (prop === "find" && name === "craftingOperations" && interrupted) return () => { throw Error("process stopped"); };
          if (prop === "updateOne" && name === "progress") return async (...args) => {
            if (point === "after_inventory") await target.updateOne(...args);
            interrupted = true; throw Error("process stopped");
          };
          return typeof target[prop] === "function" ? target[prop].bind(target) : target[prop];
        } });
      } };
      const transaction = { id, recipeId: recipe.id, recipeName: recipe.name, quantity: 1, seasonKey: "s-craft-test",
        outputs: [{ itemId: "product", quantity: 1 }], inputs: [{ itemId: "material", quantity: 5 }] };
      await assert.rejects(() => executeStandaloneCraft({ db: faultDb, playerId: player, expectedSeasonKey: "s-craft-test",
        expectedUpdatedAt: "before", nextInventory: [{ uuid: "result", itemId: "product", itemType: "consumable", stackCount: 1 }], safeGoldCost: 100, transaction }));
      const recovered = await createService().craft(player, recipe.id, 1, requestId);
      assert.equal(recovered.replayed, point === "after_inventory");
      const state = await snapshot();
      assert.equal(state.wallet.gold, 900);
      assert.equal(state.progress.inventory.find(i => i.itemId === "product").stackCount, 1);
      await recoverCraftingOperations(db, player);
      assert.deepEqual(await snapshot(), state);
    }
    await reset(4);
    const insufficient = await snapshot();
    await assert.rejects(() => service.craft(player, recipe.id, 1, "insufficient-material"), e => e.status === 400);
    assert.deepEqual(await snapshot(), insufficient);
    await reset(20, 0);
    await assert.rejects(() => service.craft(player, recipe.id, 1, "insufficient-gold"), e => e.status === 400);

    // Actual JWT route: public recipes do not bypass the global login closure.
    const express = require("express"); const app = express(); app.use(express.json());
    app.use(require("../src/api/routes/playerCraftingRoutes").createPlayerCraftingRoutes({ craftingService: service }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.code }));
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const jwt = require("jsonwebtoken");
    const headers = { Authorization: `Bearer ${jwt.sign({ discordId: player }, process.env.JWT_SECRET)}`, "Content-Type": "application/json" };
    assert.equal((await fetch(`${base}/api/me/crafting`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/me/crafting/${recipe.id}`, { method: "POST", headers, body: JSON.stringify({ quantity: 1 }) })).status, 400);
    await maintenance.setState({ enabled: true, whitelist: [] });
    assert.equal((await fetch(`${base}/api/me/crafting`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/me/crafting/${recipe.id}`, { method: "POST", headers, body: JSON.stringify({ quantity: 1, requestId: "closed-login-request" }) })).status, 403);
    console.log("PASS: public crafting, locked materials, integer bounds, 10 concurrent retries, CAS refund/retry, two crash points, persisted recovery and maintenance auth (isolated MongoDB)");
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await closeMongoClient(); await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
