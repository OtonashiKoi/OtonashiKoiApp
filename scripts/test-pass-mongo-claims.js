"use strict";
// Exercise production repositories against an ephemeral MongoDB, never player data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient, BSON } = require("mongodb");

async function main() {
  const snapshot = process.argv.find(x => x.startsWith("--items-snapshot="))?.slice(17);
  if (!snapshot) throw new Error("Provide --items-snapshot=/absolute/path/items.bson");
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  const db = client.db("pass_real_repository_test");
  require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => db;
  try {
    await require("../src/services/access/seasonStateStore").activate("isolated-pass");
    await require("../src/services/access/maintenanceStore").setState({ enabled: false, strict: false, openAt: null, activateAt: null });
    const progress = require("../src/adapters/mongo/createMongoRepositories").createMongoRepositories().progressRepository;
    const currency = require("../src/adapters/mongo/standaloneCurrencySettlement").createStandaloneCurrencySettlement({ getDb: async () => db });
    const items = { findById: id => db.collection("items").findOne({ id }) };
    const reward = { grantCurrency: x => currency.grantCurrencyAtomic({ ...x, playerId: x.discordId }) };
    const { PassService } = require("../src/services/pass/passService");
    const makePass = () => new PassService({ progressRepository: progress, itemRepository: items, rewardService: reward });
    const pass = makePass();
    const bytes = fs.readFileSync(snapshot), docs = [];
    for (let offset = 0; offset < bytes.length;) {
      const size = bytes.readInt32LE(offset), doc = BSON.deserialize(bytes.subarray(offset, offset + size));
      delete doc._id; docs.push(doc); offset += size;
    }
    await db.collection("items").insertMany(docs);
    await db.collection("serverEventConfig").insertOne({ _id: "default", passSeasonKey: "isolated-pass" });
    const fresh = async id => {
      const result = await db.collection("progress").insertOne({ playerId: id, seasonKey: "isolated-pass", level: 1, inventory: [], equipment: {}, updatedAt: new Date().toISOString(), accountWorldBossClears: { default: true } });
      await db.collection("wallets").insertOne({ playerId: id, seasonKey: "isolated-pass", gold: 100000, diamond: 10 });
      return result.insertedId;
    };
    const countItem = (p, id) => p.inventory.filter(x => x.itemId === id).reduce((n, x) => n + (x.stackCount || x.quantity || 1), 0);
    const wallet = id => db.collection("wallets").findOne({ playerId: id });
    const id = await fresh("first-reward");
    await pass.adminAddPoints("first-reward", 1219, { set: true });
    const claims = await Promise.allSettled(Array.from({ length: 10 }, () => pass.claim("first-reward", "Test", 1, "free")));
    assert.equal(claims.filter(x => x.status === "fulfilled").length, 1);
    const first = await progress.findByPlayerId("first-reward");
    assert(first._id.equals(id), "claim preserves Mongo identity");
    assert.equal(countItem(first, "72fde92d-e33f-42fb-8d86-2e811d03f84d"), 3);
    assert.equal((await wallet("first-reward")).gold, 101650);
    assert.deepEqual((await pass.getState("first-reward")).claimedFree, [1]);

    const fullId = await fresh("all-rewards");
    await pass.adminAddPoints("all-rewards", 30000, { set: true });
    await pass.unlock("all-rewards", "Test");
    for (let level = 1; level <= 30; level++) for (const track of ["free", "paid"]) await pass.claim("all-rewards", "Test", level, track);
    assert.equal((await wallet("all-rewards")).gold, 100000 + 114750 + 229500);
    assert.equal((await wallet("all-rewards")).diamond, 8);
    const full = await progress.findByPlayerId("all-rewards");
    assert(full._id.equals(fullId));
    assert.equal(countItem(full, "gem-s-tier"), 5);
    const state = await pass.getState("all-rewards");
    assert.equal(state.claimedFree.length, 30);
    assert.equal(state.claimedPaid.length, 30);
    assert.equal(full.passRewardReceipts.length, 34, "only item-bearing rewards need backpack receipts");

    await fresh("retry");
    await pass.adminAddPoints("retry", 1000, { set: true });
    const original = progress.saveIfUnchanged;
    let failOnce = true;
    progress.saveIfUnchanged = async (...args) => {
      if (failOnce) { failOnce = false; throw new Error("injected-backpack-failure"); }
      return original(...args);
    };
    await assert.rejects(() => pass.claim("retry", "Test", 1, "free"), /injected-backpack-failure/);
    assert.equal((await wallet("retry")).gold, 101650);
    assert.deepEqual((await pass.getState("retry")).claimedFree, []);
    progress.saveIfUnchanged = original;
    await makePass().claim("retry", "Test", 1, "free");
    assert.equal((await wallet("retry")).gold, 101650, "retry cannot duplicate committed gold");
    assert.equal(countItem(await progress.findByPlayerId("retry"), "72fde92d-e33f-42fb-8d86-2e811d03f84d"), 3);

    const before = await progress.findByPlayerId("first-reward");
    const cloned = structuredClone(before);
    cloned.level = 2;
    await progress.save(cloned);
    const after = await progress.findByPlayerId("first-reward");
    assert(after._id.equals(id));
    assert.equal(after.level, 2);
    assert.equal(after.accountWorldBossClears.default, true);
    const cas = structuredClone(after); cas.level = 3;
    assert.equal(await progress.saveIfUnchanged(cas, after.updatedAt), true);
    assert.equal(await progress.saveIfUnchanged({ ...cas, level: 99 }, "stale-timestamp"), false);
    const saved = await progress.findByPlayerId("first-reward");
    assert(saved._id.equals(id)); assert.equal(saved.level, 3);
    assert.equal(countItem(saved, "72fde92d-e33f-42fb-8d86-2e811d03f84d"), 3);
    console.log("PASS: actual Mongo repositories; 60 rewards; 10 concurrent claims; partial currency retry; cloned save/CAS preserves _id, inventory and account clears; stale writes rejected");
  } finally { await client.close(); await server.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
