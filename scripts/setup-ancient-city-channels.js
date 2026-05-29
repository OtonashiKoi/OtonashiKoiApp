require("dotenv").config();
const { Client, GatewayIntentBits, ChannelType } = require("discord.js");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const config = require("../src/config");

const HARD_CHANNEL_ID = "1496800925015347200";
const GUILD_ID = config.discord.guildId;

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discord.token);
  console.log(`[Discord] logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  const hardCh = await guild.channels.fetch(HARD_CHANNEL_ID);
  console.log(`原 hard 頻道：#${hardCh.name}  (parent ${hardCh.parentId})`);

  // 1. 把舊 hard 頻道改名 → 古城深處（佔大宗）
  const deepName = "🕯-古城深處";
  if (hardCh.name !== deepName) {
    await hardCh.setName(deepName, "拆分 hard → 古城深處");
    console.log(`✅ 改名 ${hardCh.id} → #${deepName}`);
  }

  // 2. 在同 category 建立 古城 頻道
  let ancientCh = guild.channels.cache.find((c) => c.parentId === hardCh.parentId && c.name === "🏰-古城");
  if (!ancientCh) {
    ancientCh = await guild.channels.create({
      name: "🏰-古城",
      type: ChannelType.GuildText,
      parent: hardCh.parentId || undefined,
      topic: "古城（Lv.20+）— 千年城牆，邪物棲居",
      reason: "拆分 hard zone 新增古城頻道",
    });
    console.log(`✅ 新建頻道 #${ancientCh.name} → ${ancientCh.id}`);
  } else {
    console.log(`↩️ 已有 #${ancientCh.name} → ${ancientCh.id}`);
  }

  // 3. 在同 category 建立 廢都王座 頻道（世界王）
  let throneCh = guild.channels.cache.find((c) => c.parentId === hardCh.parentId && c.name === "👑-廢都王座");
  if (!throneCh) {
    throneCh = await guild.channels.create({
      name: "👑-廢都王座",
      type: ChannelType.GuildText,
      parent: hardCh.parentId || undefined,
      topic: "廢都王座（Lv.30+ 世界王）— 王座之上，覆滅之主",
      reason: "拆分 hard zone 新增世界王頻道",
    });
    console.log(`✅ 新建頻道 #${throneCh.name} → ${throneCh.id}`);
  } else {
    console.log(`↩️ 已有 #${throneCh.name} → ${throneCh.id}`);
  }

  // 4. 更新 channelLayout bindings
  const db = await getMongoDb();
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  const value = layout?.value || {};
  value.discord = value.discord || {};
  const bindings = Array.isArray(value.discord.bindings) ? [...value.discord.bindings] : [];

  // 找原 monster_zone_hard 綁定，改成 ancient_city_deep（沿用同 channel）
  const idx = bindings.findIndex((b) => b.featureKey === "monster_zone_hard");
  if (idx >= 0) {
    bindings[idx] = {
      ...bindings[idx],
      featureKey: "monster_zone_ancient_city_deep",
      channelId: hardCh.id,
      enabled: true,
      panelMessageId: "",   // 清空，重啟後會重發
    };
  } else {
    bindings.push({
      featureKey: "monster_zone_ancient_city_deep",
      channelId: hardCh.id,
      enabled: true,
      panelMessageId: "",
      note: "",
      visibleTo: { player: true, admin: true },
    });
  }

  // 補上 ancient_city + wasteland_throne
  for (const [fk, chId] of [
    ["monster_zone_ancient_city", ancientCh.id],
    ["monster_zone_wasteland_throne", throneCh.id],
  ]) {
    const existing = bindings.findIndex((b) => b.featureKey === fk);
    const entry = {
      featureKey: fk,
      channelId: chId,
      enabled: true,
      panelMessageId: "",
      note: "",
      visibleTo: { player: true, admin: true },
    };
    if (existing >= 0) bindings[existing] = { ...bindings[existing], ...entry };
    else bindings.push(entry);
  }

  value.discord.bindings = bindings;
  await db.collection("channelLayout").updateOne(
    { _id: "default" },
    { $set: { value, updatedAt: new Date().toISOString() } }
  );
  console.log(`\n✅ channelLayout 已更新：`);
  console.log(`   monster_zone_ancient_city       → ${ancientCh.id}`);
  console.log(`   monster_zone_ancient_city_deep  → ${hardCh.id}`);
  console.log(`   monster_zone_wasteland_throne   → ${throneCh.id}`);

  await client.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
