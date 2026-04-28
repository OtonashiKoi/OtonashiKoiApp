const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";

async function main() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // 查詢 channelLayout
    const layoutCol = db.collection("channelLayout");
    const layout = await layoutCol.findOne({});

    if (!layout) {
      console.error("❌ 找不到 channelLayout");
      return;
    }

    console.log("📍 頻道配置：");
    Object.entries(layout).forEach(([key, value]) => {
      if (typeof value === 'object' && value.channelId) {
        console.log(`  ${key}: ${value.channelId}`);
      }
    });

    // 尋找掉落或公告相關的頻道
    const dropChannel = layout.drop_announcement || layout.announcement || layout.dropsAnnouncement;
    if (dropChannel && dropChannel.channelId) {
      console.log(`\n✅ 掉落公告頻道: ${dropChannel.channelId}`);
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
