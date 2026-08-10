"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const mongod = await MongoMemoryServer.create();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otonashi-season-reset-"));
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = "season_reset_integration";

  const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  const { createGameProgress } = require("../src/domain/progress/createGameProgress");
  const seasonState = require("../src/services/access/seasonStateStore");
  const {
    seasonResetAllPlayers,
    writeFullSeasonBackup,
  } = require("../src/services/admin/seasonResetService");
  const { createSeasonResetBackupWriter } = require("../src/services/admin/seasonResetBackupWriter");
  const { validateSeasonReset } = require("../src/services/admin/seasonResetValidationService");
  const { acquireLock, preflight, createRun, getRun } = require("../src/services/admin/seasonResetCoordinator");
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");

  try {
    const db = await getMongoDb();
    const playerId = "integration-player";
    const progress = createGameProgress(playerId);
    Object.assign(progress, {
      seasonKey: "legacy",
      level: 48,
      exp: 999,
      job: "Knight",
      inventory: [
        { uuid: "keep", itemId: "keepsake", itemType: "equipment", equipSlot: "anchor" },
        { uuid: "drop", itemId: "iron-sword", itemType: "equipment", equipSlot: "weapon" },
      ],
      pets: [{ uuid: "pet-1" }],
      activePetUuid: "pet-1",
    });
    await Promise.all([
      db.collection("progress").insertOne(progress),
      db.collection("wallets").insertOne({ playerId, gold: 1234, diamond: 77, bonusBackpackSlots: 5, seasonBackpackSlots: 9 }),
      db.collection("items").insertOne({ id: "keepsake", name: "跨季紀念物", itemType: "equipment", seasonPersistent: true }),
      db.collection("weeklyQuestProgress").insertOne({ discordId: playerId, cadence: "weekly", periodKey: "old", claimed: true }),
      db.collection("checkins").insertOne({ discordId: playerId, occurredAt: "2026-08-01T00:00:00.000Z" }),
      db.collection("auctions").insertOne({ id: "auction-1", sellerId: playerId, status: "active", item: { itemId: "iron-sword" } }),
      db.collection("transactions").insertOne({ playerId, source: "integration", amount: 10, createdAt: "2026-08-01T00:00:00.000Z" }),
      db.collection("passState").insertOne({ _id: playerId, seasonKey: "old", points: 99, unlocked: true }),
      db.collection("serverEventConfig").insertOne({ _id: "default", passSeasonKey: "old" }),
      db.collection("serverBuffs").insertOne({ id: "short", seasonPermanent: false, endsAt: "2099-01-01T00:00:00.000Z" }),
      db.collection("monsters").insertMany([
        { id: "m1", zone: "A", seq: 1, enabled: true, maxHp: 100 },
        { id: "m2", zone: "A", seq: 2, enabled: true, maxHp: 200 },
      ]),
      db.collection("monsterState").insertOne({ _id: "A", value: { activeMonsterSeq: 2, currentHp: 1, killCount: { x: 3 } } }),
    ]);

    const runId = "integration-run";
    const seasonKey = "s-integration";
    const writer = createSeasonResetBackupWriter({ backupDir: tempDir, runId, seasonKey });
    const backup = await writeFullSeasonBackup(writer, [playerId]);
    const lines = fs.readFileSync(backup.path, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(lines.at(-1).kind, "manifest");
    assert.equal(lines.at(-1).complete, true);
    assert.ok(lines.some((line) => line.kind === "transaction" && line.playerId === playerId));

    await seasonState.activate(seasonKey, { runId });
    const summary = await seasonResetAllPlayers({ dryRun: false, seasonKey, runId });
    assert.equal(summary.completed, true);

    const [after, wallet, auction, questHistory, checkinHistory, transaction] = await Promise.all([
      db.collection("progress").findOne({ playerId }),
      db.collection("wallets").findOne({ playerId }),
      db.collection("auctions").findOne({ id: "auction-1" }),
      db.collection("weeklyQuestProgressHistory").findOne({ runId }),
      db.collection("checkinHistory").findOne({ runId }),
      db.collection("transactions").findOne({ playerId }),
    ]);
    assert.equal(after.seasonKey, seasonKey);
    assert.equal(after.level, 1);
    assert.deepEqual(after.inventory.map((item) => item.itemId), ["keepsake"]);
    assert.equal(wallet.gold, 0);
    assert.equal(wallet.diamond, 77);
    assert.equal(auction.status, "season_cancelled");
    assert.ok(questHistory?.snapshot);
    assert.ok(checkinHistory?.snapshot);
    assert.ok(transaction);

    const validation = await validateSeasonReset({ seasonKey });
    assert.equal(validation.ok, true, JSON.stringify(validation.failures));
    const counts = await preflight();
    assert.equal(counts.players, 1);
    assert.equal(counts.onlinePlayers, 0);
    const repos = createMongoRepositories();
    const stale = await repos.progressRepository.findByPlayerId(playerId);
    await seasonState.activate("s-next", { runId: "stale-write-test" });
    await db.collection("progress").updateOne({ playerId }, { $set: { seasonKey: "s-next", level: 1 } });
    stale.level = 99;
    await assert.rejects(() => repos.progressRepository.save(stale), (error) => error?.code === "STALE_SEASON_WRITE");
    assert.equal((await db.collection("progress").findOne({ playerId })).level, 1);

    const queued = await createRun({ seasonKey: "s-coordinator", backupDir: tempDir });
    let run = queued;
    for (let attempt = 0; attempt < 30 && !["completed", "failed", "blocked"].includes(run.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      run = await getRun(queued._id);
    }
    assert.equal(run.status, "completed", run.error);
    assert.equal(run.validation?.ok, true);
    assert.equal(await acquireLock("lock-owner-a"), true);
    assert.equal(await acquireLock("lock-owner-b"), false);
    console.log("[SeasonResetIntegration] pass");
  } finally {
    await closeMongoClient().catch(() => {});
    await mongod.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
