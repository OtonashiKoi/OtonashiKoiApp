const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    console.log("📚 數據庫中的 Collections：\n");
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
