"use strict";

// Real inventory, drop, socket and HTTP paths against an isolated MongoDB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BSON } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = "element_stone_stacks_isolated";
  process.env.JWT_SECRET = "isolated-element-stacks-test-secret";
  const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  const { EnhanceService } = require("../src/services/enhance/enhanceService");
  const { getElementSocketCost } = require("../src/shared/enhanceConfig");
  const { normalizeEnhanceGemStacks } = require("../src/shared/inventoryStacking");
  const { runWithCache, withProgressCache } = require("../src/adapters/mongo/requestCache");
  const elements = ["water", "fire", "wood", "earth", "metal", "sun", "moon"];
  const originalRandom = Math.random;
  let cases = 0, snapshotCases = 0, server;
  try {
    const db = await getMongoDb(), repos = createMongoRepositories();
    const repo = withProgressCache(repos.progressRepository);
    const service = new EnhanceService(repo, repos.itemRepository, repos.walletRepository);
    const playerId = "isolated-element-player";
    const total = (p, id) => p.inventory.filter(e => e?.itemId === id)
      .reduce((n, e) => n + Math.max(1, Number(e.stackCount) || 1), 0);
    const read = () => db.collection("progress").findOne({ playerId });
    const seed = async (element, level = 0, quantity = 100, gold = 1000000) => {
      const itemId = `element-stone-${element}`;
      const gear = { uuid: "gear", itemId: "test-sword", itemName: "測試劍", itemType: "equipment",
        equipSlot: "weapon", tier: "S", elements: level ? { [element]: level } : {} };
      const stones = quantity ? [{ uuid: "primary", itemId, itemType: "consumable", stackCount: quantity }] : [];
      stones.push(...Array.from({ length: 24 }, (_, i) => ({ uuid: `single-${i}`, itemId, itemType: "consumable" })));
      await db.collection("progress").replaceOne({ playerId }, { playerId, seasonKey: "legacy", updatedAt: "before",
        level: 50, equipment: {}, inventory: [...stones, gear] }, { upsert: true });
      await db.collection("wallets").replaceOne({ playerId }, { playerId, gold, diamond: 77 }, { upsert: true });
    };
    await db.collection("items").insertMany(elements.map(el => ({ id: `element-stone-${el}`, name: `${el}屬性石`, itemType: "consumable" })));
    await seed("metal");
    const reproduction = await repo.findByPlayerId(playerId);
    assert.equal(reproduction.inventory.filter(e => e.itemId === "element-stone-metal").length, 1,
      "metal drops must read as one stack instead of 25 entries");
    if (process.argv.includes("--reproduce")) return;

    for (const element of elements) {
      const id = `element-stone-${element}`;
      // Existing stacks, single drops and legacy missing stackCount all add up.
      await seed(element);
      const p = await repo.findByPlayerId(playerId);
      assert.equal(total(p, id), 124);
      assert.equal(p.inventory.filter(e => e.itemId === id).length, 1);
      assert.equal(p.inventory.find(e => e.itemId === id).uuid, "primary");
      const locked = { uuid: "locked", itemId: id, stackCount: 3, locked: true };
      const unrelated = { uuid: "ordinary", itemId: "ordinary-gear", itemType: "equipment", enhanceLevel: 4 };
      const normalized = normalizeEnhanceGemStacks([...p.inventory, locked, unrelated]);
      assert.deepEqual(normalized.find(e => e.uuid === "locked"), locked);
      assert.deepEqual(normalized.find(e => e.uuid === "ordinary"), unrelated); cases++;

      for (const level of [0, 1, 2, 3, 4]) for (const success of [true, false]) {
        await seed(element, level); Math.random = () => success ? 0 : 0.999;
        const cost = getElementSocketCost(level);
        const result = await runWithCache(() => service.fillElementSocket(playerId, "gear", element));
        const after = await read();
        assert.equal(result.success, success);
        assert.equal(result.stonesUsed, cost.stones);
        assert.equal(total(after, id), 124 - cost.stones, "success and failure persist exact stone debit");
        assert.equal(after.inventory.filter(e => e.itemId === id).length, 1);
        assert.equal(after.inventory.find(e => e.uuid === "gear").elements[element] || 0, level + Number(success));
        assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold, 1000000 - cost.gold);
        const again = await repo.findByPlayerId(playerId); again.level = 49; await repo.save(again);
        assert.equal(total(await read(), id), 124 - cost.stones, "reread must not restore merged-away singles"); cases++;
      }

      // Real atomic loot receipt arrives between a read and an inventory save.
      await seed(element);
      const pending = await repo.findByPlayerId(playerId);
      service._consumeGemsFromInventory(pending.inventory, id, 12);
      const grant = { playerId, id: `drop-${element}`, entries: [{ uuid: "new-drop", itemId: id, itemType: "consumable" }] };
      await repos.progressRepository.grantInventoryRewardsBatch([grant]);
      await repos.progressRepository.grantInventoryRewardsBatch([grant]);
      await repo.save(pending);
      assert.equal(total(await read(), id), 124 - 12 + 1);
      assert.equal((await read()).inventory.filter(e => e.itemId === id).length, 1);
      pending.level = 48; await repo.save(pending);
      assert.equal(total(await read(), id), 113, "same-object second save cannot duplicate a drop"); cases++;

      // Parallel consolidation and spending must retain both debits.
      await seed(element);
      const first = await repo.findByPlayerId(playerId), second = await repo.findByPlayerId(playerId);
      service._consumeGemsFromInventory(first.inventory, id, 12);
      service._consumeGemsFromInventory(second.inventory, id, 5);
      await repo.save(second); await repo.save(first);
      assert.equal(total(await read(), id), 107); cases++;
    }

    for (const options of [{ quantity: 0, level: 4 }, { gold: 0 }, { foreign: true }]) {
      await seed("metal", options.level || 0, options.quantity ?? 100, options.gold ?? 1000000);
      const before = await read(), wallet = await repos.walletRepository.findByPlayerId(playerId);
      await assert.rejects(() => service.fillElementSocket(playerId, options.foreign ? "foreign" : "gear", "metal"));
      assert.deepEqual(await read(), before); assert.deepEqual(await repos.walletRepository.findByPlayerId(playerId), wallet); cases++;
    }

    // Actual pre-fix player inventories are copied into the isolated DB only.
    const snapshotArg = process.argv.find(arg => arg.startsWith("--snapshot="));
    if (snapshotArg) {
      const bytes = fs.readFileSync(path.join(snapshotArg.slice(11), "progress.bson"));
      for (let offset = 0; offset < bytes.length;) {
        const size = bytes.readInt32LE(offset), source = BSON.deserialize(bytes.subarray(offset, offset + size)); offset += size;
        const id = `snapshot-${snapshotCases}`;
        await db.collection("progress").insertOne({ playerId: id, seasonKey: "legacy", updatedAt: "before",
          level: 50, inventory: source.inventory, equipment: {} });
        const p = await repo.findByPlayerId(id);
        for (const element of elements) {
          const stoneId = `element-stone-${element}`;
          assert.equal(total(p, stoneId), total(source, stoneId));
          assert.ok(p.inventory.filter(e => !e.locked && e.itemId === stoneId).length <= 1);
        }
        p.inventory.push({ uuid: "snapshot-unrelated", itemId: "unrelated" }); await repo.save(p);
        const stored = await db.collection("progress").findOne({ playerId: id });
        for (const element of elements) assert.equal(total(stored, `element-stone-${element}`), total(source, `element-stone-${element}`));
        p.level = 49; await repo.save(p);
        assert.equal(total(await db.collection("progress").findOne({ playerId: id }), "element-stone-metal"), total(source, "element-stone-metal"));
        snapshotCases++;
      }
    }

    // The SPA receives a single stack from the real JWT inventory endpoint.
    await seed("metal");
    const app = require("express")();
    app.use(require("../src/api/routes/playerAppRoutes").createPlayerAppRoutes({ ...repos, progressRepository: repo }));
    app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const token = require("jsonwebtoken").sign({ discordId: playerId }, process.env.JWT_SECRET);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/me/inventory`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const inventory = (await response.json()).data.inventory;
    assert.equal(inventory.filter(e => e.itemId === "element-stone-metal").length, 1);
    assert.equal(total({ inventory }, "element-stone-metal"), 124); cases++;
    console.log(JSON.stringify({ result: "PASS", scenarios: cases, playerSnapshots: snapshotCases,
      checks: ["seven elements", "legacy stacks", "socket success and failure", "exact persisted costs", "concurrent reward and debit", "loot receipt replay", "insufficient resources", "JWT inventory HTTP", "snapshot quantity preservation"] }));
  } finally {
    Math.random = originalRandom;
    if (server) await new Promise(resolve => server.close(resolve));
    await closeMongoClient(); await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
