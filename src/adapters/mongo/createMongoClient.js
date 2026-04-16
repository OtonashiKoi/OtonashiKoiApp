const { MongoClient } = require("mongodb");
const config = require("../../config");

let cachedClient = null;
let cachedDb = null;
let indexReady = false;

async function ensureIndexes(db) {
  if (indexReady) return;

  try {
    await Promise.all([
      // 玩家和錢包（保持不變）
      db.collection("players").createIndex({ discordId: 1 }, { unique: true }),
      db.collection("wallets").createIndex({ playerId: 1 }, { unique: true }),

      // 進度（頻繁更新，加快查詢和保存）
      db.collection("progress").createIndex({ playerId: 1 }, { unique: true }),
      db.collection("progress").createIndex({ level: 1, updatedAt: -1 }),
      db.collection("progress").createIndex({ updatedAt: -1 }),

      // 交易和日誌
      db.collection("transactions").createIndex({ playerId: 1, createdAt: -1 }),
      db.collection("adminActionLogs").createIndex({ createdAt: -1 }),
      db.collection("checkins").createIndex({ discordId: 1, occurredAt: -1 }),

      // 商店和道具
      db.collection("shopItems").createIndex({ id: 1 }, { unique: true }),
      db.collection("items").createIndex({ id: 1 }, { unique: true })
    ]);

    indexReady = true;
  } catch (err) {
    console.warn("[MongoDB] Index creation warning (non-critical):", err.message);
    indexReady = true; // 即使索引創建失敗也繼續，不阻斷連接
  }
}

async function getMongoDb() {
  if (cachedDb) return cachedDb;

  if (!config.storage.mongoUri) {
    throw new Error("MONGODB_URI is required when STORAGE_DRIVER=mongo");
  }

  cachedClient = new MongoClient(config.storage.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 50,                    // 提高連接池以應對高頻更新
    socketTimeoutMS: 45000,             // 避免長連接超時
    retryWrites: true,                  // 自動重試寫入
    writeConcern: { w: 'majority' },    // 確保寫入到多個副本（如果有）
    directConnection: false             // 允許連接池優化
  });

  await cachedClient.connect();
  cachedDb = cachedClient.db(config.storage.mongoDbName);
  await ensureIndexes(cachedDb);
  return cachedDb;
}

module.exports = {
  getMongoDb
};
