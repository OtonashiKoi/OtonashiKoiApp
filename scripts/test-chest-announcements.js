"use strict";
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MongoClient } = require("mongodb");

const dbName = `qa_chest_announcements_${Date.now()}`;
process.env.MONGODB_DB_NAME = dbName;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(dbName);
  try {
    assert.match(db.databaseName, /^qa_chest_announcements_/);
    require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => db;
    require("../src/services/realtime/playerNotifyService").notifyPlayer = () => {};
    const repo = require("../src/adapters/mongo/createMongoRepositories").createMongoRepositories().progressRepository;
    const { createGameProgress } = require("../src/domain/progress/createGameProgress");
    const { ShopService } = require("../src/services/shop/shopService");
    const shop = new ShopService(null, null, null, repo, null, null, null);
    const messages = [];
    const runtime = require("../src/bot/runtimeContext");
    runtime.getBotClient = () => ({ isReady: () => true, channels: { fetch: async () => ({ isTextBased: () => true, send: async (message) => messages.push(message) }) } });
    const { _announceChestOpen } = require("../src/bot/playerPanel");
    const box = (id, count = 1, type = "open_world_boss_chest") => ({ uuid: `${id}-box`, itemId: `${id}-chest`, itemName: "測試寶箱", itemType: "consumable", itemEffect: { type, monsterId: "qa-boss" }, stackCount: count });
    async function seed(id, count, type) {
      const progress = createGameProgress(id);
      progress.inventory = [box(id, count, type)];
      await repo.save(progress);
      return progress.inventory[0].uuid;
    }
    const reward = (itemId = "s-weapon", extra = {}) => ({ uuid: randomUUID(), itemId, itemName: itemId, itemType: "equipment", equipSlot: "weapon", tier: "S", ...extra });
    shop._rollWorldBossChest = async () => ({ entry: reward() });

    const uuid = await seed("repeat", 3);
    const first = await shop.useItem("repeat", uuid, "玩家");
    assert.equal(first.chestReward.isFirstAcquisition, true);
    await _announceChestOpen("玩家", first.chestReward);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].allowedMentions, { parse: [] });
    let progress = await repo.findByPlayerId("repeat");
    assert(progress.chestAnnouncementKnownItemIds.includes("s-weapon"));

    // Ordinary progress saves must not erase the durable announcement history.
    progress.chestAnnouncementKnownItemIds = [];
    await repo.save(progress);
    assert((await repo.findByPlayerId("repeat")).chestAnnouncementKnownItemIds.includes("s-weapon"));
    const second = await shop.useItem("repeat", uuid, "玩家");
    assert.equal(second.chestReward.isFirstAcquisition, false);
    await _announceChestOpen("玩家", second.chestReward);
    assert.equal(messages.length, 1);
    progress = await repo.findByPlayerId("repeat");
    progress.inventory = progress.inventory.filter((item) => item.itemId !== "s-weapon");
    await repo.save(progress);
    const third = await shop.useItem("repeat", uuid, "玩家");
    assert.equal(third.chestReward.isFirstAcquisition, false, "sold or dismantled rewards stay known");

    const simultaneousUuid = await seed("simultaneous", 2);
    const simultaneous = await Promise.all([
      shop.useItem("simultaneous", simultaneousUuid, "玩家"),
      shop.useItem("simultaneous", simultaneousUuid, "玩家"),
    ]);
    assert.deepEqual(simultaneous.map((item) => item.chestReward.isFirstAcquisition), [true, false]);
    assert.equal((await repo.findByPlayerId("simultaneous")).inventory.filter((item) => item.itemId === "s-weapon").length, 2);

    const retryUuid = await seed("retry", 1);
    const save = shop._saveProgressWithFallback.bind(shop);
    let saves = 0;
    shop._saveProgressWithFallback = async (...args) => ++saves === 1 ? false : save(...args);
    const retried = await shop.useItem("retry", retryUuid, "玩家");
    shop._saveProgressWithFallback = save;
    assert.equal(retried.chestReward.isFirstAcquisition, true);
    assert.equal(saves, 2);
    assert((await repo.findByPlayerId("retry")).chestAnnouncementKnownItemIds.includes("s-weapon"));

    const equippedUuid = await seed("equipped", 1);
    progress = await repo.findByPlayerId("equipped");
    progress.characterSlots = { 2: { equipment: { weapon: reward() } } };
    await repo.save(progress);
    assert.equal((await shop.useItem("equipped", equippedUuid, "玩家")).chestReward.isFirstAcquisition, false);

    shop._rollWorldBossChest = async () => ({ entry: reward("card-b", { itemType: "monster_card", equipSlot: "special_1", tier: "B" }) });
    const cardUuid = await seed("card", 2);
    for (let i = 0; i < 2; i++) {
      const opened = await shop.useItem("card", cardUuid, "玩家");
      assert.equal(opened.chestReward.isCard, true);
      await _announceChestOpen("玩家", opened.chestReward);
    }
    assert.equal(messages.length, 3, "every card appears, including repeated B cards");

    shop._rollRandomWeapon = async () => ({ entry: reward("random-s") });
    const randomUuid = await seed("random", 2, "open_random_weapon");
    assert.equal((await shop.useItem("random", randomUuid, "玩家")).chestReward.isFirstAcquisition, true);
    assert.equal((await shop.useItem("random", randomUuid, "玩家")).chestReward.isFirstAcquisition, false);
    shop._rollAnchorPack = async () => ({ entry: reward("npc-card", { itemType: "monster_card", equipSlot: "special_1", tier: "D", isNpcCard: true }), isCard: true });
    const packUuid = await seed("pack", 1, "open_anchor_pack");
    const pack = await shop.useItem("pack", packUuid, "玩家");
    assert.equal(pack.chestReward.isCard, true);
    await _announceChestOpen("玩家", pack.chestReward);
    assert.equal(messages.length, 4, "D card is still announced");
    console.log("PASS chest announcements: first S, repeat and sold suppression, equipped history, concurrent opens, CAS retry, all cards, random weapon and card pack");
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
