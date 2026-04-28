const { MongoClient } = require("mongodb");

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const progressCol = db.collection("progress");

    const playerIds = ["344786855235026944", "477847935413911552", "503704064719192074"];

    for (const playerId of playerIds) {
      const progress = await progressCol.findOne({ playerId });
      if (!progress) continue;

      console.log(`\n🎯 玩家 ${playerId}`);
      console.log(JSON.stringify({
        job: progress.equipment?.job_eq?.itemName,
        mainHand: {
          name: progress.equipment?.hand_right?.itemName,
          weaponType: progress.equipment?.hand_right?.weaponType,
          itemId: progress.equipment?.hand_right?.itemId
        },
        offHand: {
          name: progress.equipment?.hand_left?.itemName,
          weaponType: progress.equipment?.hand_left?.weaponType
        }
      }, null, 2));
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
