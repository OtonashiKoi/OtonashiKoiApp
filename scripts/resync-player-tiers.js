/**
 * resync-player-tiers.js
 * 重新依據 Discord 身分組刷新所有玩家的 playerTier。
 * 用途：階級設定（Tiers）的角色對應有異動時執行。
 *
 * 用法：node scripts/resync-player-tiers.js
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { Client, GatewayIntentBits } = require("discord.js");

const MONGODB_URI  = process.env.MONGODB_URI;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID      = process.env.DISCORD_GUILD_ID;

if (!MONGODB_URI || !DISCORD_TOKEN || !GUILD_ID) {
  console.error("❌ 缺少 MONGODB_URI / DISCORD_TOKEN / DISCORD_GUILD_ID 環境變數");
  process.exit(1);
}

// 等級優先順序（高 → 低）
const TIER_RANKS = ["SS", "S", "A", "B", "C", "D", "E"];

async function run() {
  // ── 1. 連接 MongoDB ──
  const mongo = await MongoClient.connect(MONGODB_URI);
  const db = mongo.db("equipment_game");

  // 讀取 playerTiers 設定
  const tierDoc = await db.collection("playerTiers").findOne({ _id: "default" });
  const tiers = tierDoc?.value || {};
  console.log("✅ 讀取 playerTiers 設定完成");

  // ── 2. 連接 Discord Bot ──
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(DISCORD_TOKEN);
  await new Promise((r) => client.once("ready", r));
  console.log(`✅ Discord Bot 登入：${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  // 抓取全部成員（需要 Server Members Intent）
  const members = await guild.members.fetch();
  console.log(`✅ 抓取 Guild 成員：${members.size} 人`);

  // ── 3. 建立 discordId → 最高等級 mapping ──
  function resolveHighestTier(memberRoleIds) {
    for (const rank of TIER_RANKS) {
      const tier = tiers[rank];
      if (tier && Array.isArray(tier.roleIds) && tier.roleIds.some((id) => memberRoleIds.includes(id))) {
        return rank;
      }
    }
    return null;
  }

  const tierMap = new Map(); // discordId → rank | null
  for (const [id, member] of members) {
    const roleIds = [...member.roles.cache.keys()];
    tierMap.set(id, resolveHighestTier(roleIds));
  }

  // ── 4. 批量更新 progress.playerTier ──
  const progresses = await db.collection("progress").find({}).toArray();
  let updated = 0, unchanged = 0, notInGuild = 0;

  for (const prog of progresses) {
    const discordId = prog.playerId;
    if (!tierMap.has(discordId)) { notInGuild++; continue; }

    const newTier = tierMap.get(discordId);
    if (prog.playerTier === newTier) { unchanged++; continue; }

    await db.collection("progress").updateOne(
      { _id: prog._id },
      { $set: { playerTier: newTier, updatedAt: new Date().toISOString() } }
    );
    console.log(`  ${discordId}: ${prog.playerTier ?? "null"} → ${newTier ?? "null"}`);
    updated++;
  }

  console.log(`\n✅ 完成！更新 ${updated} 人 / 不變 ${unchanged} 人 / 不在 Guild ${notInGuild} 人`);

  client.destroy();
  await mongo.close();
}

run().catch((e) => { console.error("❌", e); process.exit(1); });
