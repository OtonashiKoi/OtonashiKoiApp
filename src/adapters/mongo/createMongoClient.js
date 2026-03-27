const { MongoClient } = require("mongodb");
const config = require("../../config");

let cachedClient = null;
let cachedDb = null;
let indexReady = false;

async function ensureIndexes(db) {
  if (indexReady) return;

  await Promise.all([
    db.collection("players").createIndex({ discordId: 1 }, { unique: true }),
    db.collection("wallets").createIndex({ playerId: 1 }, { unique: true }),
    db.collection("progress").createIndex({ playerId: 1 }, { unique: true }),
    db.collection("transactions").createIndex({ playerId: 1, createdAt: -1 }),
    db.collection("adminActionLogs").createIndex({ createdAt: -1 })
  ]);

  indexReady = true;
}

async function getMongoDb() {
  if (cachedDb) return cachedDb;

  if (!config.storage.mongoUri) {
    throw new Error("MONGODB_URI is required when STORAGE_DRIVER=mongo");
  }

  cachedClient = new MongoClient(config.storage.mongoUri, {
    serverSelectionTimeoutMS: 5000
  });

  await cachedClient.connect();
  cachedDb = cachedClient.db(config.storage.mongoDbName);
  await ensureIndexes(cachedDb);
  return cachedDb;
}

module.exports = {
  getMongoDb
};