const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const PLAYER_ID = "365382420419051520";
const ITEM_ID = "3856bf7d-d65e-44fb-bc06-49daef1b6da9";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // 取得玩家目前庫存
    const progressCol = db.collection("progress");
    const playerProgress = await progressCol.findOne({ playerId: PLAYER_ID });

    if (!playerProgress) {
      console.error("❌ 找不到玩家");
      return;
    }

    // 新增道具到庫存
    const newItem = {
      itemId: ITEM_ID,
      itemName: "屬性重製藥水",
      quantity: 1,
      obtainedAt: new Date()
    };

    const inventory = playerProgress.inventory || [];
    inventory.push(newItem);

    await progressCol.updateOne(
      { playerId: PLAYER_ID },
      { $set: { inventory } }
    );

    console.log(`✅ 已給玩家 ${PLAYER_ID} 發送 屬性重製藥水`);

    // 記錄操作日誌
    const logsCol = db.collection("adminActionLogs");
    await logsCol.insertOne({
      timestamp: new Date(),
      action: "grant_item",
      targetPlayer: PLAYER_ID,
      itemId: ITEM_ID,
      itemName: "屬性重製藥水",
      reason: "發現重大錯誤 - 區域經濟調整補償",
      adminId: "system"
    });

    console.log("✅ 已記錄操作日誌");
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
