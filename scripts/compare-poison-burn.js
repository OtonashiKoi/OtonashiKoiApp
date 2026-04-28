const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const jobsCol = db.collection("items");
    const thiefJob = await jobsCol.findOne({ name: { $regex: "盜賊", $options: "i" } });
    const mageJob = await jobsCol.findOne({ name: { $regex: "法師", $options: "i" } });

    if (!thiefJob || !mageJob) {
      console.log("❌ 找不到職業");
      return;
    }

    console.log("🔥 法師 - 燃燒效果：");
    const burnEffect = mageJob.combatEffects.find(e => e.key === "burn");
    if (burnEffect) {
      console.log(`  觸發率: ${burnEffect.chance}%`);
      console.log(`  傷害: ${burnEffect.params.value} ${burnEffect.params.mode}`);
      console.log(`  持續: ${burnEffect.duration.value} ${burnEffect.duration.mode}`);
      console.log(`  說明: ${burnEffect.notes}`);
    }

    console.log("\n☠️ 盜賊 - 中毒效果：");
    const poisonEffects = thiefJob.combatEffects.filter(e => e.key === "poison");
    poisonEffects.forEach(effect => {
      console.log(`  觸發率: ${effect.chance}%`);
      console.log(`  傷害: ${effect.params.value} ${effect.params.mode}`);
      console.log(`  持續: ${effect.duration.value} ${effect.duration.mode}`);
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
