/**
 * 將 game.json 的 weeklyQuests / weeklyQuestProgress 遷移到 MongoDB
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "equipment_game";
  const dataPath = process.env.JSON_DATA_PATH || path.resolve("./data/game.json");

  const raw = fs.readFileSync(dataPath, "utf8");
  const store = JSON.parse(raw);

  const quests = store.weeklyQuests || [];
  const progressMap = store.weeklyQuestProgress || {};

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // 遷移任務定義
  if (quests.length) {
    for (const q of quests) {
      await db.collection("weeklyQuests").updateOne({ id: q.id }, { $set: q }, { upsert: true });
    }
    console.log(`✅ 遷移 ${quests.length} 筆任務定義`);
  } else {
    console.log("⚠️  game.json 中沒有 weeklyQuests 資料");
  }

  // 遷移玩家進度
  let count = 0;
  for (const [discordId, weeks] of Object.entries(progressMap)) {
    for (const [weekLabel, progress] of Object.entries(weeks)) {
      await db.collection("weeklyQuestProgress").updateOne(
        { discordId, weekLabel },
        { $set: { discordId, weekLabel, progress, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      count++;
    }
  }
  console.log(`✅ 遷移 ${count} 筆玩家進度`);

  await client.close();
  console.log("完成！");
}

main().catch(e => { console.error(e); process.exit(1); });
