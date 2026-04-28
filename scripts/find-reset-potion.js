const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const itemsCol = db.collection("shop_items");

    const items = await itemsCol.find({ $or: [
      { name: { $regex: "重製|重置|藥水|藥劑", $options: "i" } }
    ] }).toArray();

    console.log("🔍 找到相關道具：");
    items.forEach(item => {
      console.log(`  ID: ${item.id}`);
      console.log(`  名稱: ${item.name}`);
      console.log(`  描述: ${item.description}\n`);
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
