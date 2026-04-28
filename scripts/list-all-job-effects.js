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
    const thiefJob = await jobsCol.findOne({ id: "job_rogue_v1" });

    console.log("🔥 法師 - 所有效果觸發率：\n");
    
    const mageEffects = [
      ...mageJob.passiveEffects,
      ...mageJob.procEffects,
      ...mageJob.combatEffects
    ];

    mageEffects.forEach(effect => {
      console.log(`${effect.key}`);
      console.log(`  觸發率: ${effect.chance}%`);
      console.log(`  觸發條件: ${effect.trigger}`);
      console.log(`  說明: ${effect.notes}`);
      console.log();
    });

    console.log("\n☠️ 盜賊 - 所有效果觸發率：\n");
    
    const thiefEffects = [
      ...thiefJob.passiveEffects,
      ...thiefJob.procEffects,
      ...thiefJob.combatEffects
    ];

    thiefEffects.forEach(effect => {
      console.log(`${effect.key}`);
      console.log(`  觸發率: ${effect.chance}%`);
      console.log(`  觸發條件: ${effect.trigger}`);
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
