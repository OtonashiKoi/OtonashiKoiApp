const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const itemsCol = db.collection("shopItems");

    const items = await itemsCol.find({}).toArray();

    console.log(`📦 所有商店道具列表（共 ${items.length} 個）：\n`);
    items.forEach(item => {
      console.log(`  名稱: ${item.name}`);
      console.log(`  ID: ${item.id}`);
      console.log(`  類型: ${item.itemType}`);
      console.log(`  ---`);
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
