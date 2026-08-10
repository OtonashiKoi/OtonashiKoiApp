const { MongoClient } = require("mongodb");
const config = require("../../config");

let cachedClient = null;
let cachedDb = null;
let connectionPromise = null;
let indexReady = false;
let streamBindingSyncReady = false;

async function ensureStreamBindingDiscordPlatformUniqueIndex(db) {
  const collection = db.collection("streamAccountBindings");
  const indexName = "discordId_1_platform_1_unique";
  const indexes = await collection.listIndexes().toArray().catch(() => []);
  if (indexes.some((index) => index.name === indexName && index.unique === true)) return;
  const duplicates = await collection.aggregate([
    { $match: { discordId: { $type: "string", $gt: "" }, platform: { $type: "string", $gt: "" } } },
    { $group: { _id: { discordId: "$discordId", platform: "$platform" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  if (duplicates.length) {
    console.info(`[MongoDB] streamAccountBindings unique index deferred: ${duplicates.length} duplicate key group(s) require review`);
    return;
  }
  await collection.createIndex({ discordId: 1, platform: 1 }, { unique: true, name: indexName });
}

async function ensureIndexes(db) {
  if (indexReady) return;

  try {
    await Promise.all([
      // 玩家和錢包（保持不變）
      db.collection("players").createIndex({ discordId: 1 }, { unique: true }),
      db.collection("wallets").createIndex({ playerId: 1 }, { unique: true }),
      db.collection("streamAccountBindings").createIndex({ platform: 1, platformUserId: 1 }, { unique: true }),
      db.collection("creatorTokens").createIndex({ provider: 1 }, { unique: true }),

      // 進度（頻繁更新，加快查詢和保存）
      db.collection("progress").createIndex({ playerId: 1 }, { unique: true }),
      db.collection("progress").createIndex({ level: 1, updatedAt: -1 }),
      db.collection("progress").createIndex({ updatedAt: -1 }),

      // 交易和日誌
      db.collection("transactions").createIndex({ playerId: 1, createdAt: -1 }),
      db.collection("transactions").createIndex({ createdAt: -1 }),
      db.collection("transactions").createIndex(
        { source: 1, sourceRef: 1 },
        {
          unique: true,
          partialFilterExpression: {
            source: "donation:reward",
            sourceRef: { $gt: "" }
          }
        }
      ),
      // TTL:打怪相關高頻紀錄(掛 expireAt 的)到期自動刪除,避免 transactions 無限膨脹。
      // 只有帶 expireAt 欄位的文件會被清,其他交易(賭場/商店/拍賣…)不受影響、永久保留。
      db.collection("transactions").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      // TTL:賭場局紀錄(casinoRounds)掛 expireAt(30天),到期自動刪除,防膨脹。
      db.collection("casinoRounds").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("adminActionLogs").createIndex({ createdAt: -1 }),
      db.collection("checkins").createIndex({ discordId: 1, occurredAt: -1 }),
      db.collection("weeklyQuestProgress").createIndex({ discordId: 1, cadence: 1, periodKey: 1 }, { unique: true }),
      // 唯一道具發放：一個玩家對一個 itemId 一生只發一次（原子搶佔靠此唯一索引）
      db.collection("uniqueItemGrants").createIndex({ discordId: 1, itemId: 1 }, { unique: true }),
      db.collection("weeklyQuestProgress").createIndex({ cadence: 1, periodKey: 1 }),
      db.collection("weeklyQuestProgress").createIndex({ weekLabel: 1 }),
      db.collection("monsterState").createIndex({ _id: 1 }),
      db.collection("monsters").createIndex({ zone: 1, enabled: 1, spawnRate: -1 }),
      db.collection("monsters").createIndex({ id: 1 }, { unique: true, partialFilterExpression: { id: { $type: "string" } } }),

      // 直播記錄層（斗內事件流水 / 會員變動）
      db.collection("donationEvents").createIndex({ createdAt: -1 }),
      db.collection("donationEvents").createIndex(
        { sourceRef: 1 },
        { unique: true, partialFilterExpression: { sourceRef: { $type: "string" } } }
      ),
      db.collection("membershipEvents").createIndex({ at: -1 }),
      db.collection("membershipEvents").createIndex({ discordId: 1, at: -1 }),
      db.collection("membershipStatus").createIndex({ discordId: 1 }, { unique: true }),
      db.collection("membershipStatus").createIndex({ isMember: 1, lastChangedAt: -1 }),

      // 主線故事
      db.collection("storyChapters").createIndex({ id: 1 }, { unique: true }),
      db.collection("storyChapters").createIndex({ enabled: 1, order: 1 }),
      db.collection("storyChapters").createIndex({ zoneKey: 1 }),
      db.collection("storyNpcs").createIndex({ id: 1 }, { unique: true }),

      // 商店和道具
      db.collection("shopItems").createIndex({ id: 1 }, { unique: true }),
      db.collection("items").createIndex({ id: 1 }, { unique: true }),
      db.collection("seasonResetRuns").createIndex({ createdAt: -1 }),
      db.collection("seasonResetRunPlayers").createIndex({ runId: 1, playerId: 1 }, { unique: true }),
      db.collection("weeklyQuestProgressHistory").createIndex({ archiveKey: 1 }, { unique: true }),
      db.collection("checkinHistory").createIndex({ archiveKey: 1 }, { unique: true })
    ]);

    // 舊環境可能已有同 key pattern 的非 unique 索引。先查重；有重複只回報，
    // 不自動刪玩家綁定。資料乾淨時才以新名稱補上 unique index。
    await ensureStreamBindingDiscordPlatformUniqueIndex(db);

    indexReady = true;
  } catch (err) {
    console.warn("[MongoDB] Index creation warning (non-critical):", err.message);
    indexReady = true; // 即使索引創建失敗也繼續，不阻斷連接
  }
}

async function syncLegacyStreamBindings(db) {
  if (streamBindingSyncReady) return;

  try {
    const players = await db.collection("players")
      .find({ externalIds: { $exists: true, $ne: null } })
      .project({ discordId: 1, displayName: 1, externalIds: 1, externalIdLinkedAt: 1 })
      .toArray();

    let migrated = 0;
    let duplicates = 0;
    let skipped = 0;

    for (const player of players) {
      const externalIds = player?.externalIds || {};
      for (const [platformRaw, platformUserIdRaw] of Object.entries(externalIds)) {
        const platform = String(platformRaw || "").trim().toLowerCase();
        const platformUserId = String(platformUserIdRaw || "").trim();
        if (!["youtube", "twitch"].includes(platform) || !platformUserId || !player.discordId) {
          skipped += 1;
          continue;
        }

        const linkedAt = player?.externalIdLinkedAt?.[platform] || player?.updatedAt || new Date().toISOString();
        const doc = {
          platform,
          platformUserId,
          discordId: player.discordId,
          displayName: player.displayName || "",
          linkedAt,
          updatedAt: new Date().toISOString()
        };

        try {
          await db.collection("streamAccountBindings").updateOne(
            { platform, platformUserId, discordId: player.discordId },
            { $set: doc },
            { upsert: true }
          );
          migrated += 1;
        } catch (err) {
          if (err?.code === 11000) {
            duplicates += 1;
            continue;
          }
          console.warn("[MongoDB] stream binding legacy sync failed:", err.message);
        }
      }
    }

    console.log(`[MongoDB] Stream binding legacy sync done. migrated=${migrated}, duplicates=${duplicates}, skipped=${skipped}`);
  } catch (err) {
    console.warn("[MongoDB] Stream binding legacy sync warning:", err.message);
  } finally {
    streamBindingSyncReady = true;
  }
}

async function getMongoDb() {
  if (cachedDb) return cachedDb;
  if (connectionPromise) return connectionPromise;

  if (!config.storage.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  connectionPromise = (async () => {
    const client = new MongoClient(config.storage.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      minPoolSize: 5,
      maxPoolSize: 50,
      maxIdleTimeMS: 120000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      writeConcern: { w: "majority" },
      directConnection: false,
    });
    try {
      await client.connect();
      const db = client.db(config.storage.mongoDbName);
      await ensureIndexes(db);
      await syncLegacyStreamBindings(db);
      cachedClient = client;
      cachedDb = db;
      return db;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  })();
  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

async function closeMongoClient() {
  if (connectionPromise) await connectionPromise.catch(() => {});
  const client = cachedClient;
  cachedClient = null;
  cachedDb = null;
  indexReady = false;
  streamBindingSyncReady = false;
  connectionPromise = null;
  if (client) await client.close();
}

module.exports = {
  getMongoDb,
  closeMongoClient,
};
