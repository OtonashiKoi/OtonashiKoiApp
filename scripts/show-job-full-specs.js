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

    console.log("═══════════════════════════════════════");
    console.log("🔥 法師徽章");
    console.log("═══════════════════════════════════════\n");
    
    console.log("📊 屬性加成:");
    console.log(`  INT +${mageJob.equipStats.int}, VIT +${mageJob.equipStats.vit}, LUK +${mageJob.equipStats.luk}\n`);

    console.log("💪 被動效果 (Passive):");
    mageJob.passiveEffects.forEach(e => {
      console.log(`  • ${e.notes}`);
    });

    console.log("\n⚔️ 命中效果 (On Hit):");
    mageJob.procEffects.forEach(e => {
      console.log(`  • ${e.notes}`);
    });

    console.log("\n🎯 戰鬥效果 (Combat):");
    mageJob.combatEffects.forEach(e => {
      console.log(`  • ${e.notes}`);
    });

    console.log("\n\n═══════════════════════════════════════");
    console.log("☠️ 盜賊徽章");
    console.log("═══════════════════════════════════════\n");

    console.log("📊 屬性加成:");
    console.log(`  STR +${thiefJob.equipStats.str}, AGI +${thiefJob.equipStats.agi}, LUK +${thiefJob.equipStats.luk}\n`);

    console.log("💪 被動效果 (Passive):");
    thiefJob.passiveEffects.forEach(e => {
      console.log(`  • ${e.notes}`);
    });

    console.log("\n⚔️ 命中效果 (On Hit):");
    thiefJob.procEffects.forEach(e => {
      console.log(`  • ${e.notes}`);
    });

    console.log("\n🎯 戰鬥效果 (Combat):");
    thiefJob.combatEffects.forEach(e => {
      console.log(`  • ${e.notes}`);
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
