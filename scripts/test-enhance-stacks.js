"use strict";

// Real repository/service paths, with an isolated MongoDB and no live players.
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = "enhance_stacks_isolated";
  process.env.JWT_SECRET = "isolated-enhance-stack-test-secret";
  const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  const { EnhanceService } = require("../src/services/enhance/enhanceService");
  const { ENHANCE_GEMS, getEnhanceCost } = require("../src/shared/enhanceConfig");
  const { runWithCache, withProgressCache } = require("../src/adapters/mongo/requestCache");
  const originalRandom = Math.random;
  let server;
  let cases = 0;
  try {
    const db = await getMongoDb();
    const repos = createMongoRepositories();
    const repo = withProgressCache(repos.progressRepository);
    const service = new EnhanceService(repo, repos.itemRepository, repos.walletRepository);
    await db.collection("items").insertOne({ id: "test-dagger", name: "測試匕首",
      itemType: "equipment", passiveEffects: [], procEffects: [], useEffects: [], combatEffects: [] });
    const playerId = "isolated-enhance-player";
    const total = (p, id) => p.inventory.filter(i => i?.itemId === id)
      .reduce((sum, i) => sum + Math.max(1, Number(i.stackCount) || 1), 0);
    const read = () => db.collection("progress").findOne({ playerId });
    const seed = async ({ tier = "B", level = 3, singles = 24, gems = 100,
      equipped = false, gold = 1000000 } = {}) => {
      const gear = { uuid: "gear", itemId: "test-dagger", itemName: `測試匕首 +${level}`,
        itemType: "equipment", equipSlot: "weapon", weaponType: "dagger", tier,
        enhanceLevel: level, equipStats: { agi: 10 } };
      const stacks = [{ uuid: "primary", itemId: ENHANCE_GEMS[tier], stackCount: gems },
        ...Array.from({ length: singles }, (_, i) => ({ uuid: `single-${i}`, itemId: ENHANCE_GEMS[tier], stackCount: 1 }))];
      await db.collection("progress").replaceOne({ playerId }, { playerId, level: 50,
        seasonKey: "legacy", updatedAt: "before", inventory: [...stacks, ...(equipped ? [] : [gear])],
        equipment: equipped ? { weapon: gear } : {}, activeEffects: [] }, { upsert: true });
      await db.collection("wallets").replaceOne({ playerId }, { playerId, gold, diamond: 77 }, { upsert: true });
    };
    const attempt = async (options = {}) => {
      await seed(options);
      const tier = options.tier || "B";
      const before = await read();
      const fee = getEnhanceCost(tier, options.level ?? 3);
      const mult = options.mode === "gamble" ? 0.5 : 1;
      Math.random = () => options.success ? 0 : 0.999;
      const result = await runWithCache(() => service.enhanceEquipment(playerId, "gear", { mode: options.mode }));
      const after = await read();
      const spent = Math.ceil(fee.gemsRequired * mult);
      assert.equal(total(after, ENHANCE_GEMS[tier]), total(before, ENHANCE_GEMS[tier]) - spent,
        `${tier} +${options.level ?? 3} ${options.mode || "normal"}: persisted gem cost`);
      assert.equal(result.gemsUsed, spent);
      assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold,
        1000000 - Math.ceil(fee.goldRequired * mult));
      const gear = options.equipped ? after.equipment.weapon : after.inventory.find(i => i.uuid === "gear");
      assert.equal(gear?.enhanceLevel, (options.level ?? 3) + (options.success ? 1 : 0));
      assert.equal(after.inventory.filter(i => i.itemId === ENHANCE_GEMS[tier]).length, 1);
      // Re-reading and an unrelated save must never mint the old secondary stacks again.
      for (let i = 0; i < 2; i++) {
        const p = await repo.findByPlayerId(playerId);
        p.level = 50;
        await repo.save(p);
        assert.equal(total(await read(), ENHANCE_GEMS[tier]), total(after, ENHANCE_GEMS[tier]));
      }
      cases++;
    };

    // The reported +12 on failure and only -1 on +4→+5 both arise from 24 old single stacks.
    if (process.argv.includes("--reproduce")) {
      for (const level of [3, 4]) {
        await seed({ level }); Math.random = () => 0.999;
        const before = total(await read(), ENHANCE_GEMS.B);
        const result = await service.enhanceEquipment(playerId, "gear");
        console.log(JSON.stringify({ level, expectedSpend: result.gemsUsed,
          actualChange: total(await read(), ENHANCE_GEMS.B) - before }));
      }
      return;
    }
    for (const tier of ["D", "C", "B", "A", "S"]) {
      for (const level of [0, 1, 2, 3, 4]) {
        for (const success of [true, false]) {
          // +0→+1 cannot fail because its normal success rate is 100%.
          if (level === 0 && !success) continue;
          for (const equipped of [false, true]) await attempt({ tier, level, success, equipped });
          if (level >= 1) await attempt({ tier, level, success, mode: "gamble" });
        }
      }
    }

    // A concurrent reward may grow either the primary or a secondary raw stack.
    for (const target of ["primary", "single-0", "new-drop"]) {
      await seed();
      const p = await repo.findByPlayerId(playerId);
      service._consumeGemsFromInventory(p.inventory, ENHANCE_GEMS.B, 12);
      if (target === "new-drop") {
        await db.collection("progress").updateOne({ playerId }, { $push: { inventory:
          { uuid: target, itemId: ENHANCE_GEMS.B, stackCount: 7 } }, $set: { updatedAt: target } });
      } else {
        await db.collection("progress").updateOne({ playerId, "inventory.uuid": target },
          { $inc: { "inventory.$.stackCount": 7 }, $set: { updatedAt: target } });
      }
      const saved = await repo.save(p);
      assert.equal(total(await read(), ENHANCE_GEMS.B), 124 - 12 + 7);
      assert.equal(total(saved, ENHANCE_GEMS.B), 124 - 12 + 7);
      saved.level = 49;
      await repo.save(saved);
      assert.equal(total(await read(), ENHANCE_GEMS.B), 124 - 12 + 7);
      p.level = 48;
      await repo.save(p);
      assert.equal(total(await read(), ENHANCE_GEMS.B), 124 - 12 + 7);
      cases++;
    }
    // Exhausting every old stack must not recreate its secondary entries.
    await seed({ gems: 1, singles: 24 });
    const exhausted = await repo.findByPlayerId(playerId);
    service._consumeGemsFromInventory(exhausted.inventory, ENHANCE_GEMS.B, 25);
    await repo.save(exhausted);
    assert.equal(total(await read(), ENHANCE_GEMS.B), 0); cases++;

    // A second save on the original object (return value ignored) cannot reapply normalization.
    await seed();
    const original = await repo.findByPlayerId(playerId);
    service._consumeGemsFromInventory(original.inventory, ENHANCE_GEMS.B, 12);
    await repo.save(original);
    original.level = 49;
    await repo.save(original);
    assert.equal(total(await read(), ENHANCE_GEMS.B), 112); cases++;

    // A parallel save may consolidate the same raw UUIDs, or spend from that gem pool.
    for (const concurrentSpend of [0, 5]) {
      await seed();
      const pending = await repo.findByPlayerId(playerId);
      service._consumeGemsFromInventory(pending.inventory, ENHANCE_GEMS.B, 12);
      const other = await repo.findByPlayerId(playerId);
      service._consumeGemsFromInventory(other.inventory, ENHANCE_GEMS.B, concurrentSpend);
      other.inventory.push({ uuid: "other-loot", itemId: "other-item" });
      await repo.save(other);
      await repo.save(pending);
      assert.equal(total(await read(), ENHANCE_GEMS.B), 124 - 12 - concurrentSpend);
      assert.ok((await read()).inventory.some(i => i.uuid === "other-loot")); cases++;
    }

    // Simulate a network error AFTER MongoDB committed the inventory update.
    await seed(); Math.random = () => 0.999;
    const originalCollection = db.collection.bind(db); let injected = false;
    db.collection = function(name, ...args) {
      const collection = originalCollection(name, ...args);
      if (name !== "progress") return collection;
      return new Proxy(collection, { get(target, property) {
        if (property === "updateOne") return async (...updateArgs) => {
          const result = await target.updateOne(...updateArgs);
          if (!injected && updateArgs[1]?.$push?.inventorySaveReceipts) {
            injected = true; throw Error("injected post-commit network failure");
          }
          return result;
        };
        const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    try {
      await service.enhanceEquipment(playerId, "gear");
      assert.ok(injected);
      assert.equal(total(await read(), ENHANCE_GEMS.B), 112);
      assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold, 975000);
      assert.equal((await read()).inventorySaveReceipts.length, 1); cases++;
    } finally { db.collection = originalCollection; }

    // Exhausting one CAS loop must retry with a guard, never force-write the bag.
    await seed(); let casCalls = 0;
    db.collection = function(name, ...args) {
      const collection = originalCollection(name, ...args);
      if (name !== "progress") return collection;
      return new Proxy(collection, { get(target, property) {
        if (property === "updateOne") return async (...updateArgs) => {
          if (updateArgs[1]?.$push?.inventorySaveReceipts) {
            assert.ok(updateArgs[0].updatedAt, "all inventory writes must use CAS");
            if (++casCalls <= 5) return { matchedCount: 0 };
          }
          return target.updateOne(...updateArgs);
        };
        const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    try {
      const pending = await repo.findByPlayerId(playerId);
      service._consumeGemsFromInventory(pending.inventory, ENHANCE_GEMS.B, 12);
      await repo.save(pending);
      assert.equal(casCalls, 6); assert.equal(total(await read(), ENHANCE_GEMS.B), 112); cases++;
    } finally { db.collection = originalCollection; }

    // Repeated failing attempts serialize and each pays once, even in a request cache.
    await seed(); Math.random = () => 0.999;
    await Promise.all(Array.from({ length: 5 }, () => runWithCache(() => service.enhanceEquipment(playerId, "gear"))));
    assert.equal(total(await read(), ENHANCE_GEMS.B), 124 - 5 * 12);
    assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold, 1000000 - 5 * 25000); cases++;

    // Insufficient gems/gold and another player's item must reject without spending.
    for (const options of [{ gems: 11, singles: 0 }, { gold: 24999 }, { foreign: true }, { level: 5 }]) {
      await seed(options);
      const before = await read(); const wallet = await repos.walletRepository.findByPlayerId(playerId);
      await assert.rejects(() => service.enhanceEquipment(playerId, options.foreign ? "foreign-gear" : "gear"));
      assert.deepEqual(await read(), before);
      assert.deepEqual(await repos.walletRepository.findByPlayerId(playerId), wallet); cases++;
    }

    // Real player JWT route and request caching, isolated from production.
    const express = require("express"), app = express(); app.use(express.json());
    app.use((req, res, next) => runWithCache(next));
    app.use(require("../src/api/routes/playerAppRoutes").createPlayerAppRoutes({ enhanceService: service }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.code, message: error.message }));
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = require("jsonwebtoken").sign({ discordId: playerId }, process.env.JWT_SECRET);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    await seed({ tier: "A", level: 4 }); Math.random = () => 0;
    const infoResponse = await fetch(`${base}/api/me/enhance/gear`, { headers });
    assert.equal(infoResponse.status, 200);
    const info = await infoResponse.json(); assert.equal(info.data.gemsOwned, 124); assert.equal(info.data.gemsRequired, 25);
    const response = await fetch(`${base}/api/me/enhance/gear`, { headers, method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    assert.equal(total(await read(), ENHANCE_GEMS.A), 99);
    assert.equal((await read()).inventory.find(i => i.uuid === "gear").enhanceLevel, 5); cases++;
    console.log(`PASS: ${cases} isolated MongoDB enhancement/stack scenarios, including JWT HTTP and persisted readback`);
  } finally {
    Math.random = originalRandom;
    if (server) await new Promise(resolve => server.close(resolve));
    await closeMongoClient(); await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
