const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const PLAYER_ID = "365382420419051520";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // 查詢 players collection
    const playersCol = db.collection("players");
    const player = await playersCol.findOne({ _id: PLAYER_ID });
    
    if (player) {
      console.log("✅ 在 players collection 找到玩家：");
      console.log(JSON.stringify(player, null, 2));
    } else {
      console.log("❌ 在 players 找不到");
    }

    // 查詢 progress collection
    const progressCol = db.collection("progress");
    const progress = await progressCol.findOne({ playerId: PLAYER_ID });
    
    if (progress) {
      console.log("\n✅ 在 progress collection 找到玩家進度：");
      console.log(JSON.stringify(progress, null, 2).slice(0, 500));
    } else {
      console.log("❌ 在 progress 找不到");
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
