// 列出指定類別下的所有頻道，並對照 AVAILABLE_FEATURES 找出尚未被後台管理的頻道
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const CATEGORY_ID = process.argv[2] || "1450056286921166868";
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// 從 adminConsoleService 載入目前已管理的 feature keys
const AVAILABLE_FEATURES = [
  "park_announcement", "town_chat", "coin_shop", "auction_house",
  "personal_room",
  "monster_zone_beginner", "monster_zone", "monster_zone_mid",
  "monster_zone_hard", "monster_zone_elite",
  "monster_zone_nightmare", "monster_zone_abyss", "monster_zone_mythic",
  "idle_zone"
];

async function main() {
  if (!TOKEN || !GUILD_ID) {
    console.error("❌ 缺少 DISCORD_TOKEN 或 DISCORD_GUILD_ID");
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await client.login(TOKEN);
  await new Promise((res) => client.once("ready", res));

  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();

  // 找出類別
  const category = channels.get(CATEGORY_ID);
  console.log(`\n📁 類別：${category ? category.name : "(找不到)"} (${CATEGORY_ID})\n`);

  // 列出類別下的所有頻道
  const inCategory = [...channels.values()]
    .filter((ch) => ch && ch.parentId === CATEGORY_ID)
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  // 讀取目前 channelLayout
  const { MongoClient } = require("mongodb");
  const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URL || "mongodb://localhost:27017";
  const mongoDb = process.env.MONGODB_DB_NAME || "equipmentGame";
  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const layoutDoc = await mongo.db(mongoDb).collection("channelLayout").findOne({});
  await mongo.close();

  const bindings = layoutDoc?.value?.discord?.bindings || layoutDoc?.discord?.bindings || [];
  const boundChannelIds = new Set(bindings.map((b) => b.channelId).filter(Boolean));
  const boundFeatureKeys = new Set(bindings.filter((b) => b.channelId).map((b) => b.featureKey));

  console.log(`類別下共 ${inCategory.length} 個頻道：\n`);
  console.log("─".repeat(80));

  const unmanaged = [];
  for (const ch of inCategory) {
    const status = boundChannelIds.has(ch.id);
    const binding = bindings.find((b) => b.channelId === ch.id);
    const tag = status
      ? `✅ 已綁定 → ${binding.featureKey}`
      : "⚠️ 未綁定（後台管不到）";
    console.log(`  #${ch.name.padEnd(28)} ${ch.id}  ${tag}`);
    if (!status) unmanaged.push(ch);
  }

  console.log("─".repeat(80));
  console.log(`\n📊 統計：已綁定 ${inCategory.length - unmanaged.length} / 未綁定 ${unmanaged.length}\n`);

  // 未綁定的頻道清單
  if (unmanaged.length > 0) {
    console.log("⚠️ 以下頻道目前後台沒辦法控制：\n");
    unmanaged.forEach((ch) => {
      console.log(`  • #${ch.name} (${ch.id})`);
    });
  }

  // AVAILABLE_FEATURES 中尚未被任何頻道綁定的 key
  const unboundFeatures = AVAILABLE_FEATURES.filter((k) => !boundFeatureKeys.has(k));
  if (unboundFeatures.length > 0) {
    console.log("\n📋 AVAILABLE_FEATURES 中尚未綁定頻道的功能：");
    unboundFeatures.forEach((k) => console.log(`  • ${k}`));
  }

  await client.destroy();
}

main().catch((err) => {
  console.error("❌ 錯誤:", err.message);
  process.exit(1);
});
