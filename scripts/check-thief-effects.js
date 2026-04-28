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

    if (!thiefJob) {
      console.log("❌ 找不到盜賊");
      return;
    }

    console.log("☠️ 盜賊所有 on_hit debuff 效果：\n");
    
    const effects = thiefJob.combatEffects.filter(e => 
      e.trigger === "on_hit" && e.target === "enemy"
    );

    effects.forEach(effect => {
      console.log(`${effect.key.toUpperCase()}`);
      console.log(`  觸發率: ${effect.chance}%`);
      console.log(`  傷害/效果: ${effect.params.value} ${effect.params.mode || ""}`);
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
