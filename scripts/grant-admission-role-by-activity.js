/**
 * grant-admission-role-by-activity.js
 *
 * 規則：
 * - 有打卡紀錄(checkins.discordId)；或
 * - EXP > 1 且有打過怪(transactions.source 以 monster: 開頭)
 * => 發放指定 Discord 身分組
 *
 * 用法：
 *   node scripts/grant-admission-role-by-activity.js --dry-run
 *   node scripts/grant-admission-role-by-activity.js --yes
 * 可選：
 *   --role="【音無樂園】-入園券"
 *   --exp=1
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

const explicitRoleName = (argMap.role || "").trim();
const EXP_THRESHOLD = Number.parseFloat(argMap.exp || "1");
const DO_APPLY = args.includes("--yes") && !args.includes("--dry-run");

const ROLE_NAME_CANDIDATES = [
  "【音無樂園】-入園券",
  "音無樂園入場卷",
  "音無樂園入場券",
  "音無樂園入門票",
];

function normalizeDiscordId(v) {
  const s = String(v || "").trim();
  return s && /^\d{8,}$/.test(s) ? s : null;
}

function pickTargetRole(guild, name) {
  if (name) return guild.roles.cache.find((r) => r.name === name) || null;
  for (const candidate of ROLE_NAME_CANDIDATES) {
    const found = guild.roles.cache.find((r) => r.name === candidate);
    if (found) return found;
  }
  return null;
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

    const targetRole = pickTargetRole(guild, explicitRoleName);
    if (!targetRole) {
      throw new Error(
        explicitRoleName
          ? `找不到身分組：${explicitRoleName}`
          : `找不到目標身分組。已嘗試：${ROLE_NAME_CANDIDATES.join(" / ")}`
      );
    }
    console.log(`✅ 目標身分組：${targetRole.name} (${targetRole.id})`);

    const checkinIdsRaw = await db.collection("checkins").distinct("discordId");
    const progressRows = await db
      .collection("progress")
      .find({ exp: { $gt: EXP_THRESHOLD } }, { projection: { playerId: 1, exp: 1 } })
      .toArray();
    const monsterTxIdsRaw = await db.collection("transactions").distinct("playerId", {
      source: { $regex: "^monster:" },
    });

    const checkinSet = new Set(checkinIdsRaw.map(normalizeDiscordId).filter(Boolean));
    const expSet = new Set(progressRows.map((r) => normalizeDiscordId(r.playerId)).filter(Boolean));
    const monsterSet = new Set(monsterTxIdsRaw.map(normalizeDiscordId).filter(Boolean));

    const expAndMonsterSet = new Set();
    for (const id of expSet) {
      if (monsterSet.has(id)) expAndMonsterSet.add(id);
    }

    const candidates = new Set([...checkinSet, ...expAndMonsterSet]);

    let memberNotFound = 0;
    let alreadyHasRole = 0;
    let toGrant = 0;
    let grantOk = 0;
    let grantFail = 0;

    for (const discordId of candidates) {
      const member = guild.members.cache.get(discordId) || (await guild.members.fetch(discordId).catch(() => null));
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
          await member.roles.add(
            targetRole.id,
            `auto grant: checkin OR (exp>${EXP_THRESHOLD} and has monster transaction)`
          );
          grantOk++;
        } catch (e) {
          grantFail++;
          console.warn(`⚠️ 發放失敗 ${discordId}: ${e.message}`);
        }
      }
    }

    console.log("\n=== 統計 ===");
    console.log(`checkin 人數: ${checkinSet.size}`);
    console.log(`exp>${EXP_THRESHOLD} 人數: ${expSet.size}`);
    console.log(`有 monster 戰鬥紀錄人數: ${monsterSet.size}`);
    console.log(`exp 且打過怪人數: ${expAndMonsterSet.size}`);
    console.log(`符合條件聯集人數: ${candidates.size}`);
    console.log(`已有身分組: ${alreadyHasRole}`);
    console.log(`不在伺服器: ${memberNotFound}`);
    console.log(`待發放: ${toGrant}`);
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

