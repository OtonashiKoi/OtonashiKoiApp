const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const jobsCol = db.collection("items");

    const mageJob = await jobsCol.findOne({ id: "job_mage_v1" });

    console.log("🔥 法師雙手杖特效檢查：\n");
    
    const doubleHandEffects = mageJob.combatEffects.filter(e => 
      e.condition?.weaponType === "staff_2h" && e.trigger === "on_hit"
    );

    console.log(`✅ 找到 ${doubleHandEffects.length} 個特效：\n`);
    doubleHandEffects.forEach(effect => {
      console.log(`${effect.key.toUpperCase()}`);
      console.log(`  觸發率: ${effect.chance}%`);
      console.log(`  ${effect.notes}`);
      console.log();
    });

    if (doubleHandEffects.length === 3) {
      console.log("✅ 正確！雙手杖有麻痺、燒傷、冰凍三個特效");
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
