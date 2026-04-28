const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const monstersCol = db.collection("monsters");

    const midMonsters = await monstersCol.find({ zone: "mid" }).toArray();
    const hardMonsters = await monstersCol.find({ zone: "hard" }).toArray();

    console.log("📊 Mid 區怪物獲得金幣數值：");
    midMonsters.forEach(m => {
      console.log(`  ${m.name}: ${m.goldReward || 0} 金幣`);
    });

    console.log("\n📊 Hard 區怪物獲得金幣數值：");
    hardMonsters.forEach(m => {
      console.log(`  ${m.name}: ${m.goldReward || 0} 金幣`);
    });

    const midAvg = midMonsters.reduce((sum, m) => sum + (m.goldReward || 0), 0) / midMonsters.length;
    const hardAvg = hardMonsters.reduce((sum, m) => sum + (m.goldReward || 0), 0) / hardMonsters.length;

    console.log(`\n📈 Mid 區平均獲得: ${midAvg.toFixed(2)} 金幣`);
    console.log(`📈 Hard 區平均獲得: ${hardAvg.toFixed(2)} 金幣`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
