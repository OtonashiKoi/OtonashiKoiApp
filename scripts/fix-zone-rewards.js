const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const monstersCol = db.collection("monsters");

    // Mid 區：進場費 200、獲得金幣 2200
    const midResult = await monstersCol.updateMany(
      { zone: "mid" },
      { $set: { entryFee: 200, goldReward: 2200 } }
    );
    console.log(`✅ Mid 區: ${midResult.modifiedCount} 隻怪物設定為進場費 200、獲得 2200 金幣`);

    // Hard 區：進場費 350、獲得金幣 2350
    const hardResult = await monstersCol.updateMany(
      { zone: "hard" },
      { $set: { entryFee: 350, goldReward: 2350 } }
    );
    console.log(`✅ Hard 區: ${hardResult.modifiedCount} 隻怪物設定為進場費 350、獲得 2350 金幣`);

    console.log("\n✅ 所有數值已調整完成");
    console.log("   Mid 區淨利: 2200 - 200 = 2000 金幣");
    console.log("   Hard 區淨利: 2350 - 350 = 2000 金幣");
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
