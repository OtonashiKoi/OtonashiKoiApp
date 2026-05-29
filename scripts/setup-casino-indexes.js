// 建立賭場相關 collection 索引
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

(async () => {
  const db = await getMongoDb();
  console.log("建立 casinoBets 索引...");
  await db.collection("casinoBets").createIndex({ roundId: 1, discordId: 1 });
  await db.collection("casinoBets").createIndex({ discordId: 1, createdAt: -1 });
  await db.collection("casinoBets").createIndex({ outcome: 1, createdAt: -1 });

  console.log("建立 casinoRounds 索引...");
  await db.collection("casinoRounds").createIndex({ roundId: -1 }, { unique: true });
  await db.collection("casinoRounds").createIndex({ createdAt: -1 });

  console.log("完成。");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
