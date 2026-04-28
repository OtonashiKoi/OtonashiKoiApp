const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // 查詢 channelLayout
    const layoutCol = db.collection("channelLayout");
    const layouts = await layoutCol.find({}).toArray();

    console.log(`📍 channelLayout 記錄（共 ${layouts.length} 筆）：\n`);
    layouts.forEach((layout, idx) => {
      console.log(`記錄 ${idx + 1}:`);
      console.log(JSON.stringify(layout, null, 2).slice(0, 800));
      console.log("---");
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
