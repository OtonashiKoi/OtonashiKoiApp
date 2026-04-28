const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const progressCol = db.collection("progress");
    const itemsCol = db.collection("items");

    const playerIds = ["344786855235026944", "477847935413911552", "503704064719192074"];

    for (const playerId of playerIds) {
      const progress = await progressCol.findOne({ playerId });
      if (!progress) {
        console.log(`❌ 玩家 ${playerId} 不存在\n`);
        continue;
      }

      const jobId = progress.equipment?.job_eq?.itemId;
      const mainWeapon = progress.equipment?.hand_right?.itemName;
      
      const jobEq = await itemsCol.findOne({ id: jobId });
      
      console.log(`🎯 玩家 ${playerId}`);
      console.log(`  職業: ${jobEq?.name || "未裝備"}`);
      console.log(`  主武器: ${mainWeapon || "無"}`);
      console.log(`  職業 procEffects: ${jobEq?.procEffects?.length || 0} 個`);
      console.log(`  職業 combatEffects: ${jobEq?.combatEffects?.length || 0} 個`);
      
      // 檢查雙手杖效果
      if (jobEq?.combatEffects) {
        const twoHandEffects = jobEq.combatEffects.filter(e => 
          e.condition?.weaponType === "staff_2h" || 
          e.condition?.weaponType === "dagger" ||
          !e.condition?.weaponType
        );
        console.log(`  符合條件的效果: ${twoHandEffects.length} 個`);
      }
      console.log();
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
