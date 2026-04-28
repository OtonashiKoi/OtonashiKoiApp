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

    console.log("🔥 法師 - 燃燒：");
    const burnEffect = mageJob.procEffects.find(e => e.key === "burn");
    console.log(`  觸發率: ${burnEffect.chance}%`);
    console.log(`  傷害: ${burnEffect.params.value}% HP`);
    console.log(`  持續: ${burnEffect.duration.value} 回合`);
    console.log(`  ${burnEffect.notes}\n`);

    console.log("☠️ 盜賊 - 中毒：");
    const poisonEffect = thiefJob.procEffects.find(e => e.key === "proc_poison");
    console.log(`  觸發率: ${poisonEffect.chance}%`);
    console.log(`  傷害: ${poisonEffect.params.value}% HP`);
    console.log(`  持續: ${poisonEffect.duration.value} 回合`);
    console.log(`  疊加: +${poisonEffect.params.stackAdd}% 每次，最高 ${poisonEffect.params.maxPct}%`);
    console.log(`  ${poisonEffect.notes}`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
