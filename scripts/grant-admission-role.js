/**
 * grant-admission-role.js
 *
 * 規則：
 * - 錢包金幣 > GOLD_THRESHOLD（預設 300） 或
 * - 在 checkins 集合有任何紀錄
 * => 補發指定 Discord 身分組（預設：音無樂園入門票）
 *
 * 用法：
 *   node scripts/grant-admission-role.js --yes
 * 可選：
 *   --role="音無樂園入門票"
 *   --threshold=300
 *   --dry-run
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const { Client, GatewayIntentBits } = require("discord.js");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!MONGODB_URI || !DISCORD_TOKEN || !GUILD_ID) {
  console.error("❌ 缺少 MONGODB_URI / DISCORD_TOKEN / DISCORD_GUILD_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
const argMap = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const i = a.indexOf("=");
      return [a.slice(2, i), a.slice(i + 1)];
    })
);

const ROLE_NAME = (argMap.role || "音無樂園入門票").trim();
const GOLD_THRESHOLD = Number.parseInt(argMap.threshold || "300", 10);
const DO_APPLY = args.includes("--yes") && !args.includes("--dry-run");

function normalizeDiscordId(v) {
  const s = String(v || "").trim();
  return s && /^\d{8,}$/.test(s) ? s : null;
}

async function run() {
  const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  try {
    console.log("⏳ 連接 MongoDB...");
    await mongo.connect();
    const db = mongo.db(DB_NAME);

    console.log("⏳ 連接 Discord Bot...");
    await client.login(DISCORD_TOKEN);
    await new Promise((resolve) => client.once("ready", resolve));
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.roles.fetch();
    await guild.members.fetch();

    const targetRole = guild.roles.cache.find((r) => r.name === ROLE_NAME);
    if (!targetRole) {
      throw new Error(`找不到身分組：${ROLE_NAME}`);
    }
    console.log(`✅ 目標身分組：${targetRole.name} (${targetRole.id})`);

    const wallets = await db.collection("wallets").find({}, { projection: { playerId: 1, gold: 1 } }).toArray();
    const checkinIdsRaw = await db.collection("checkins").distinct("discordId");

    const byGold = new Set();
    for (const w of wallets) {
      const id = normalizeDiscordId(w.playerId);
      if (!id) continue;
      if (Number(w.gold || 0) > GOLD_THRESHOLD) byGold.add(id);
    }

    const byCheckin = new Set();
    for (const id0 of checkinIdsRaw) {
      const id = normalizeDiscordId(id0);
      if (id) byCheckin.add(id);
    }

    const candidates = new Set([...byGold, ...byCheckin]);
    const candidateList = [...candidates];

    let alreadyHasRole = 0;
    let toGrant = 0;
    let memberNotFound = 0;
    let grantOk = 0;
    let grantFail = 0;

    for (const discordId of candidateList) {
      const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        memberNotFound++;
        continue;
      }
      if (member.roles.cache.has(targetRole.id)) {
        alreadyHasRole++;
        continue;
      }
      toGrant++;
      if (DO_APPLY) {
        try {
          await member.roles.add(targetRole.id, `auto grant: gold>${GOLD_THRESHOLD} or has checkin`);
          grantOk++;
        } catch (e) {
          grantFail++;
          console.warn(`⚠️ 發放失敗 ${discordId}: ${e.message}`);
        }
      }
    }

    console.log("\n=== 統計 ===");
    console.log(`wallets 總數: ${wallets.length}`);
    console.log(`checkins 使用者數: ${byCheckin.size}`);
    console.log(`符合條件總人數(聯集): ${candidateList.length}`);
    console.log(`已有身分組: ${alreadyHasRole}`);
    console.log(`待發放: ${toGrant}`);
    console.log(`不在 Discord 伺服器: ${memberNotFound}`);
    if (DO_APPLY) {
      console.log(`發放成功: ${grantOk}`);
      console.log(`發放失敗: ${grantFail}`);
    } else {
      console.log("目前為 dry-run，未實際發放。加 --yes 才會套用。");
    }
  } finally {
    try { client.destroy(); } catch (_) {}
    try { await mongo.close(); } catch (_) {}
  }
}

run().catch((e) => {
  console.error("❌ 執行失敗：", e.message);
  process.exit(1);
});

