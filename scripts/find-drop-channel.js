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

    if (!layout || !layout.value || !layout.value.discord || !layout.value.discord.bindings) {
      console.error("❌ 無法解析 channelLayout");
      return;
    }

    const bindings = layout.value.discord.bindings;
    
    console.log("📍 所有頻道綁定：\n");
    bindings.forEach(binding => {
      if (binding.featureKey && binding.featureKey.includes('drop') || binding.featureKey.includes('announcement')) {
        console.log(`✅ ${binding.featureKey}: ${binding.channelId}`);
      } else {
        console.log(`   ${binding.featureKey}: ${binding.channelId}`);
      }
    });

    // 尋找掉落相關的頻道
    const dropBinding = bindings.find(b => b.featureKey && b.featureKey.includes('drop'));
    if (dropBinding) {
      console.log(`\n🎯 掉落公告頻道: ${dropBinding.channelId}`);
    } else {
      console.log("\n❌ 找不到掉落公告頻道，請提供頻道ID");
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
