/**
 * Dev Mirror — 啟動一個臨時的 in-memory MongoDB，並把雲端 Atlas 的資料完整 clone 進來。
 *
 * 用途：本機開發時想要「跟生產環境一樣的資料」，但又不能寫到雲端。
 * 啟動方式：在啟動指令前面加 DEV_MIRROR=1 環境變數。
 *
 * 注意：
 *  - 純 dev 用，不要在 production 啟動。
 *  - 資料在記憶體裡，process 結束就消失，下次啟動會重新從 Atlas clone。
 *  - require("mongodb-memory-server") 是 dev dependency，production 不會載入這個檔。
 */

const { MongoClient } = require("mongodb");

const DEFAULT_PORT = 27018;
const DEFAULT_DB_NAME = "equipmentGame";

let activeMemoryServer = null;

async function startDevMirror({ sourceUri, dbName = DEFAULT_DB_NAME, port = DEFAULT_PORT } = {}) {
  if (!sourceUri) {
    throw new Error("[DEV_MIRROR] 來源 MONGODB_URI 為空，無法 clone");
  }

  const { MongoMemoryServer } = require("mongodb-memory-server");

  console.log("[DEV_MIRROR] 啟動本地 in-memory MongoDB…");
  const memServer = await MongoMemoryServer.create({
    instance: { port, dbName }
  });
  activeMemoryServer = memServer;
  const localUri = memServer.getUri();
  console.log(`[DEV_MIRROR] 本地 MongoDB 已啟動：${localUri}`);

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
      // 跳過系統 collection
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

    console.log(`[DEV_MIRROR] ✅ Clone 完成，共 ${totalDocs} 個文件，跟雲端資料一致`);
    console.log(`[DEV_MIRROR] ⚠️ 這份資料只存在於記憶體，process 結束就消失`);
  } finally {
    await sourceClient.close().catch(() => undefined);
    await localClient.close().catch(() => undefined);
  }

  // 處理優雅關閉
  const cleanup = async (signal) => {
    console.log(`\n[DEV_MIRROR] ${signal} 收到，關閉本地 MongoDB…`);
    if (activeMemoryServer) {
      await activeMemoryServer.stop().catch(() => undefined);
      activeMemoryServer = null;
    }
    process.exit(0);
  };
  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("SIGTERM", () => cleanup("SIGTERM"));

  return localUri;
}

module.exports = { startDevMirror };
