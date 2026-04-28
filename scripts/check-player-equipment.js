const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const progressCol = db.collection("progress");

    const playerId = "344786855235026944";
    const progress = await progressCol.findOne({ playerId });

    if (!progress) {
      console.log("❌ 玩家不存在");
      return;
    }

    console.log("📦 玩家裝備數據：");
    console.log(JSON.stringify(progress.equipment, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
