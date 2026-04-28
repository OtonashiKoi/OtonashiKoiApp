const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const PLAYER_ID = "365382420419051520";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const progressCol = db.collection("progress");

    const player = await progressCol.findOne({ discordId: PLAYER_ID });
    if (player) {
      console.log("✅ 找到玩家：");
      console.log(JSON.stringify(player, null, 2));
    } else {
      console.log("❌ 找不到此玩家，查詢所有玩家：");
      const allPlayers = await progressCol.find({}).limit(5).toArray();
      allPlayers.forEach(p => {
        console.log(`  discordId: ${p.discordId}, displayName: ${p.displayName}`);
      });
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
