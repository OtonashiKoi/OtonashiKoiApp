/**
 * revoke-admission-role.js
 *
 * 用途：
 * - 批次移除指定 Discord 身分組（預設：音無樂園入場卷 / 入場券 / 入門票）
 *
 * 用法：
 *   node scripts/revoke-admission-role.js --dry-run
 *   node scripts/revoke-admission-role.js --yes
 * 可選：
 *   --role="音無樂園入門票"
 */

require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error("❌ 缺少 DISCORD_TOKEN / DISCORD_GUILD_ID");
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
const DO_APPLY = args.includes("--yes") && !args.includes("--dry-run");

const ROLE_NAME_CANDIDATES = [
  "音無樂園入場卷",
  "音無樂園入場券",
  "音無樂園入門票",
];

function pickTargetRole(guild, name) {
  if (name) {
    return guild.roles.cache.find((r) => r.name === name) || null;
  }
  for (const candidate of ROLE_NAME_CANDIDATES) {
    const found = guild.roles.cache.find((r) => r.name === candidate);
    if (found) return found;
  }
  return null;
}

async function run() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  try {
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
    const holders = guild.members.cache.filter((m) => m.roles.cache.has(targetRole.id));

    let removeOk = 0;
    let removeFail = 0;

    for (const member of holders.values()) {
      if (!DO_APPLY) continue;
      try {
        await member.roles.remove(targetRole.id, "bulk revoke admission role");
        removeOk++;
      } catch (e) {
        removeFail++;
        console.warn(`⚠️ 移除失敗 ${member.user.tag} (${member.id}): ${e.message}`);
      }
    }

    console.log("\n=== 統計 ===");
    console.log(`持有身分組人數: ${holders.size}`);
    if (DO_APPLY) {
      console.log(`移除成功: ${removeOk}`);
      console.log(`移除失敗: ${removeFail}`);
    } else {
      console.log("目前為 dry-run，未實際移除。加 --yes 才會套用。");
    }
  } finally {
    try { client.destroy(); } catch (_) {}
  }
}

run().catch((e) => {
  console.error("❌ 執行失敗：", e.message);
  process.exit(1);
});

