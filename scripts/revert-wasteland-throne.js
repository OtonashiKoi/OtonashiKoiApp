require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const config = require("../src/config");

const THRONE_CHANNEL_ID = "1508647978079092839";  // 廢都王座（要刪）
const DEEP_CHANNEL_ID   = "1496800925015347200";  // 古城深處（廢都魔王回這）

async function main() {
  const db = await getMongoDb();

  // 1. DB：廢都魔王 zone 改回 ancient_city_deep
  const updateMonster = await db.collection("monsters").updateOne(
    { name: "廢都魔王(B)" },
    { $set: { zone: "ancient_city_deep", updatedAt: new Date().toISOString() } }
  );
  console.log(`✅ 廢都魔王(B) zone → ancient_city_deep  (matched=${updateMonster.matchedCount})`);

  // 2. DB：worldBossConfig.targetZone 改回 ancient_city_deep
  const wbCfg = await db.collection("worldBossConfig").findOne({ _id: "default" });
  if (wbCfg) {
    const next = { ...(wbCfg.value || wbCfg) };
    next.targetZone = "ancient_city_deep";
    await db.collection("worldBossConfig").updateOne(
      { _id: "default" },
      { $set: { value: next, targetZone: "ancient_city_deep", updatedAt: new Date().toISOString() } }
    );
    console.log(`✅ worldBossConfig.targetZone → ancient_city_deep`);
  }

  // 3. DB：移除 channelLayout 中的 wasteland_throne 綁定
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  if (layout?.value?.discord?.bindings) {
    const filtered = layout.value.discord.bindings.filter(
      (b) => b.featureKey !== "monster_zone_wasteland_throne"
    );
    layout.value.discord.bindings = filtered;
    await db.collection("channelLayout").updateOne(
      { _id: "default" },
      { $set: { value: layout.value, updatedAt: new Date().toISOString() } }
    );
    console.log(`✅ channelLayout 移除 monster_zone_wasteland_throne 綁定`);
  }

  // 4. Discord：刪除 廢都王座 頻道
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discord.token);
  console.log(`[Discord] logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(config.discord.guildId);
  try {
    const throneCh = await guild.channels.fetch(THRONE_CHANNEL_ID);
    if (throneCh) {
      await throneCh.delete("廢都魔王不需要獨立版位，回到古城深處");
      console.log(`✅ 已刪除 Discord 頻道 #${throneCh.name} (${THRONE_CHANNEL_ID})`);
    }
  } catch (err) {
    console.log(`⚠️ 刪除頻道失敗或已不存在：${err.message}`);
  }
  await client.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
