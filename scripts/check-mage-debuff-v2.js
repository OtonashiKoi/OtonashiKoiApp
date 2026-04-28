const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const jobsCol = db.collection("items");
    const mageJob = await jobsCol.findOne({ name: { $regex: "法師", $options: "i" } });

    if (!mageJob || !mageJob.combatEffects) {
      console.log("❌ 找不到法師職業或效果");
      return;
    }

    console.log("📊 法師職業 Debuff 效果：\n");
    
    const effects = mageJob.combatEffects.filter(e => 
      e.trigger === "on_hit" && e.target === "enemy"
    );

    effects.forEach(effect => {
      console.log(`${effect.key.toUpperCase()}`);
      console.log(`  觸發率: ${effect.chance}%`);
      console.log(`  持續: ${effect.duration.value} ${effect.duration.mode}`);
      console.log(`  武器條件: ${effect.condition?.weaponType || "無"}`);
      console.log(`  說明: ${effect.notes}`);
      console.log();
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
