/**
 * Dev Mirror — 啟動本地持久化 MongoDB，並從雲端 Atlas clone 一份資料當基礎。
 *
 * 用途：本機開發時想要「跟生產環境一樣的資料」，但又不能寫到雲端。
 * 啟動方式：在啟動指令前面加 DEV_MIRROR=1 環境變數。
 *
 * 持久化機制（2026-05-22 改造）：
 *  - mongod 資料存到 ./.dev-mirror-data/ （gitignored）
 *  - 第一次啟動 / 資料夾為空 → 從 Atlas clone
 *  - 後續啟動 → 直接重用既存資料，broadcaster token / 玩家綁定都保留
 *  - 想強制重新 clone → 加 DEV_MIRROR_RECLONE=1
 *
 * 注意：
 *  - 純 dev 用，不要在 production 啟動
 *  - require("mongodb-memory-server") 是 dev dependency，production 不會載入這個檔
 */

const path = require("path");
const fs = require("fs");
const { MongoClient } = require("mongodb");

const DEFAULT_PORT = 27018;
const DEFAULT_DB_NAME = "equipmentGame";
const DEFAULT_DB_PATH = path.resolve(process.cwd(), ".dev-mirror-data");

let activeMemoryServer = null;

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function dirHasMongoData(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  const entries = fs.readdirSync(dbPath);
  // wiredTiger 在 dbPath 內會有 storage.bson / WiredTiger 等檔案
  return entries.some((e) => e.startsWith("WiredTiger") || e === "storage.bson" || e.endsWith(".wt"));
}

async function startDevMirror({ sourceUri, dbName = DEFAULT_DB_NAME, port = DEFAULT_PORT, dbPath = DEFAULT_DB_PATH } = {}) {
  if (!sourceUri) {
    throw new Error("[DEV_MIRROR] 來源 MONGODB_URI 為空，無法 clone");
  }

  const reclone = process.env.DEV_MIRROR_RECLONE === "1";
  ensureDir(dbPath);

  // 如果要強制重 clone，先清掉資料夾
  if (reclone) {
    console.log(`[DEV_MIRROR] DEV_MIRROR_RECLONE=1，先清空 ${dbPath}`);
    for (const entry of fs.readdirSync(dbPath)) {
      fs.rmSync(path.join(dbPath, entry), { recursive: true, force: true });
    }
  }

  const hasExistingData = dirHasMongoData(dbPath);
  const { MongoMemoryServer } = require("mongodb-memory-server");

  console.log(`[DEV_MIRROR] 啟動本地 MongoDB (dbPath=${dbPath})…`);
  const memServer = await MongoMemoryServer.create({
    instance: {
      port,
      dbName,
      storageEngine: "wiredTiger",
      dbPath
    }
  });
  activeMemoryServer = memServer;
  const localUri = memServer.getUri();
  console.log(`[DEV_MIRROR] 本地 MongoDB 已啟動：${localUri}`);

  if (hasExistingData) {
    console.log("[DEV_MIRROR] ♻️ 偵測到既有資料，跳過 Atlas clone（如要強制重新 clone，加 DEV_MIRROR_RECLONE=1）");
  } else {
    await cloneFromAtlas({ sourceUri, dbName, localUri });
  }

  // 處理優雅關閉
  const cleanup = async (signal) => {
    console.log(`\n[DEV_MIRROR] ${signal} 收到，關閉本地 MongoDB…`);
    if (activeMemoryServer) {
      await activeMemoryServer.stop({ doCleanup: false, force: false }).catch(() => undefined);
      activeMemoryServer = null;
    }
    process.exit(0);
  };
  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("SIGTERM", () => cleanup("SIGTERM"));

  return localUri;
}

async function cloneFromAtlas({ sourceUri, dbName, localUri }) {
  console.log("[DEV_MIRROR] 連線到雲端 Atlas…");
  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10_000 });
  await sourceClient.connect();
  const sourceDb = sourceClient.db(dbName);

  const localClient = new MongoClient(localUri);
  await localClient.connect();
  const localDb = localClient.db(dbName);

  try {
    const collections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
    console.log(`[DEV_MIRROR] 找到 ${collections.length} 個 collection，開始 clone…`);

    let totalDocs = 0;
    for (const { name } of collections) {
      if (name.startsWith("system.")) continue;
      const docs = await sourceDb.collection(name).find({}).toArray();
      if (docs.length === 0) {
        console.log(`[DEV_MIRROR]   ${name}: 空 collection，跳過`);
        continue;
      }
      await localDb.collection(name).insertMany(docs, { ordered: false });
      totalDocs += docs.length;
      console.log(`[DEV_MIRROR]   ${name}: ${docs.length} docs`);
    }

    console.log(`[DEV_MIRROR] ✅ Clone 完成，共 ${totalDocs} 個文件`);
    console.log(`[DEV_MIRROR] 💾 之後重啟會直接重用，broadcaster token / 玩家綁定都會保留`);
  } finally {
    await sourceClient.close().catch(() => undefined);
    await localClient.close().catch(() => undefined);
  }
}

module.exports = { startDevMirror };
