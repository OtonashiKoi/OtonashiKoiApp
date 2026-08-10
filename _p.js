require("dotenv").config();
const { getMongoDb } = require("./src/adapters/mongo/createMongoClient");
(async () => {
  const db = await getMongoDb();
  const b = await db.collection("items").findOne({ id: "job_rogue_v1" });
  console.log("=== 盜賊徽章完整效果 ===");
  for (const arr of ["passiveEffects","procEffects","combatEffects"]) {
    (b[arr]||[]).forEach(e => console.log(`  [${arr}] ${e.key}  chance=${e.chance}  trigger=${e.trigger}  params=${JSON.stringify(e.params)}  condition=${JSON.stringify(e.condition)||"-"}`));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
