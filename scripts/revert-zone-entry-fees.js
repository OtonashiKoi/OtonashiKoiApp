const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const monstersCol = db.collection("monsters");

    // 恢復 Mid 區（zone: mid）所有怪物入場費為 100
    const midResult = await monstersCol.updateMany(
      { zone: "mid" },
      { $set: { entryFee: 100 } }
    );
    console.log(`✅ Mid 區: ${midResult.modifiedCount} 隻怪物恢復為 100 金幣入場費`);

    // 恢復 Hard 區（zone: hard）所有怪物入場費為 100
    const hardResult = await monstersCol.updateMany(
      { zone: "hard" },
      { $set: { entryFee: 100 } }
    );
    console.log(`✅ Hard 區: ${hardResult.modifiedCount} 隻怪物恢復為 100 金幣入場費`);

    console.log("\n✅ 所有入場費已回滾至上一個版本（100 金幣）");
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
