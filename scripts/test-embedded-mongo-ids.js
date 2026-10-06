"use strict";
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient, ObjectId, BSON } = require("mongodb");
const { normalizeInventoryEntryMongoId } = require("../src/shared/inventoryStorage");

async function main() {
  const id = new ObjectId("0123456789abcdef01234567");
  const original = { _id: id, itemId: "gem", uuid: "existing", stackCount: 7, itemName: "Gem" };
  let nested = original;
  for (let i = 0; i < 165; i++) nested = BSON.deserialize(BSON.serialize(structuredClone(nested)));
  const normalized = normalizeInventoryEntryMongoId(structuredClone(nested));
  assert.deepEqual(normalized, { ...original, _id: id.toHexString() });
  assert(original._id.equals(id), "input Mongo identity remains unchanged");
  for (let i = 0; i < 200; i++) {
    assert.deepEqual(BSON.deserialize(BSON.serialize(structuredClone(normalized))), normalized);
  }

  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  const db = client.db("embedded_mongo_id_test");
  require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => db;
  try {
    await require("../src/services/access/seasonStateStore").activate("id-test");
    await require("../src/services/access/maintenanceStore").setState({ enabled: false, strict: false, openAt: null, activateAt: null });
    const repository = require("../src/adapters/mongo/createMongoRepositories").createMongoRepositories().progressRepository;
    const progressId = new ObjectId();
    await db.collection("progress").insertOne({ _id: progressId, playerId: "test", seasonKey: "id-test", level: 10,
      inventory: [nested], equipment: {}, normalLiveDropReceipts: [{ id: "old-reward", entries: [nested] }],
      updatedAt: new Date().toISOString() });
    for (let i = 0; i < 40; i++) {
      const current = await repository.findByPlayerId("test");
      assert.equal(await repository.saveIfUnchanged(structuredClone(current), current.updatedAt), true);
    }
    let stored = await db.collection("progress").findOne({ playerId: "test" });
    assert(stored._id.equals(progressId), "top-level Mongo identity is preserved");
    assert.deepEqual(stored.normalLiveDropReceipts, [{ id: "old-reward", entries: [normalized] }]);
    assert.equal(stored.inventory[0].stackCount, 7);
    const grant = { playerId: "test", id: "new-reward", seasonKey: "id-test", entries: [structuredClone({ ...original, uuid: "new" })] };
    await repository.grantInventoryRewardsBatch([grant]);
    await repository.grantInventoryRewardsBatch([grant]);
    stored = await db.collection("progress").findOne({ playerId: "test" });
    assert.equal(stored.inventory.reduce((sum, entry) => sum + entry.stackCount, 0), 14);
    assert.equal(stored.normalLiveDropReceipts.length, 2, "replay cannot duplicate receipt or loot");
    assert.equal(stored.normalLiveDropReceipts[1].entries[0]._id, id.toHexString());
    assert.equal(stored.inventory[1]._id, id.toHexString());
    console.log("PASS: 165-layer repair; 200 BSON clone cycles; 40 actual Mongo CAS writes; atomic loot replay preserves quantities and identities");
  } finally { await client.close(); await server.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
