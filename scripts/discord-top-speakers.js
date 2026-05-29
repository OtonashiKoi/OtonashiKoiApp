// Usage:
//   node scripts/discord-top-speakers.js "萬事皆可聊" 2026-03-01 2026-05-28
//
// Counts non-bot messages in a Discord text channel over a Taiwan-local date range.
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, ChannelType, Events } = require("discord.js");

const channelNameOrId = process.argv[2] || "萬事皆可聊";
const startDate = process.argv[3] || "2026-03-01";
const endDate = process.argv[4] || "2026-05-28";
const includeBots = process.argv.includes("--include-bots");

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000;

function taiwanDateStartMs(dateText) {
  return Date.parse(`${dateText}T00:00:00.000+08:00`);
}

function taiwanDateEndMs(dateText) {
  return Date.parse(`${dateText}T23:59:59.999+08:00`);
}

function formatTaiwan(ms) {
  return new Date(ms + TAIWAN_OFFSET_MS).toISOString().replace("T", " ").slice(0, 19) + " +08:00";
}

function sanitizeFilenamePart(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, "_");
}

async function resolveChannel(client) {
  if (!GUILD_ID) throw new Error("Missing DISCORD_GUILD_ID");

  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();

  const byId = channels.get(channelNameOrId);
  if (byId) return byId;

  const normalized = channelNameOrId.replace(/^#/, "").trim();
  const matches = [...channels.values()].filter((ch) => {
    if (!ch) return false;
    if (ch.name !== normalized) return false;
    return [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ].includes(ch.type);
  });

  if (matches.length === 0) throw new Error(`Channel not found: ${channelNameOrId}`);
  if (matches.length > 1) {
    const detail = matches.map((ch) => `#${ch.name} (${ch.id})`).join(", ");
    throw new Error(`Multiple channels matched "${channelNameOrId}": ${detail}`);
  }
  return matches[0];
}

async function main() {
  if (!TOKEN) throw new Error("Missing DISCORD_TOKEN");

  const startMs = taiwanDateStartMs(startDate);
  const endMs = taiwanDateEndMs(endDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new Error(`Invalid date range: ${startDate} to ${endDate}`);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await client.login(TOKEN);
  await new Promise((resolve) => client.once(Events.ClientReady, resolve));

  const channel = await resolveChannel(client);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    throw new Error(`#${channel?.name || channelNameOrId} is not a fetchable text channel`);
  }

  const counts = new Map();
  const users = new Map();
  let before;
  let fetchedTotal = 0;
  let countedTotal = 0;
  let scannedInRange = 0;
  let oldestSeen = null;
  let newestSeen = null;
  let batchCount = 0;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    batchCount += 1;

    const messages = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    fetchedTotal += messages.length;

    for (const msg of messages) {
      before = msg.id;
      oldestSeen = oldestSeen == null ? msg.createdTimestamp : Math.min(oldestSeen, msg.createdTimestamp);
      newestSeen = newestSeen == null ? msg.createdTimestamp : Math.max(newestSeen, msg.createdTimestamp);

      if (msg.createdTimestamp > endMs) continue;
      if (msg.createdTimestamp < startMs) continue;

      scannedInRange += 1;
      if (!includeBots && msg.author?.bot) continue;

      const id = msg.author?.id || "unknown";
      counts.set(id, (counts.get(id) || 0) + 1);
      users.set(id, {
        id,
        username: msg.author?.username || "unknown",
        displayName: msg.member?.displayName || msg.author?.globalName || msg.author?.username || "unknown",
        bot: Boolean(msg.author?.bot),
      });
      countedTotal += 1;
    }

    if (messages[messages.length - 1].createdTimestamp < startMs) break;
    if (batchCount % 10 === 0) {
      console.error(
        `[progress] batches=${batchCount}, fetched=${fetchedTotal}, counted=${countedTotal}, oldest=${formatTaiwan(oldestSeen)}`,
      );
    }
  }

  const ranking = [...counts.entries()]
    .map(([id, count]) => ({ ...users.get(id), count }))
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, "zh-Hant"))
    .slice(0, 10);

  const generatedAt = formatTaiwan(Date.now());
  const lines = [
    `# Discord 頻道發言統計：#${channel.name}`,
    "",
    `- 統計區間：${startDate} 00:00:00 至 ${endDate} 23:59:59（Asia/Taipei, UTC+8）`,
    `- 頻道：#${channel.name} (${channel.id})`,
    `- Bot 訊息：${includeBots ? "已計入" : "已排除"}`,
    `- 區間內訊息數：${scannedInRange}`,
    `- 納入排行訊息數：${countedTotal}`,
    `- 掃描訊息數：${fetchedTotal}`,
    `- 掃描範圍：${oldestSeen == null ? "無" : formatTaiwan(oldestSeen)} ～ ${newestSeen == null ? "無" : formatTaiwan(newestSeen)}`,
    `- 產生時間：${generatedAt}`,
    "",
    "## 前十名",
    "",
    "| 名次 | 顯示名稱 | Discord ID | 訊息數 |",
    "|---:|---|---|---:|",
  ];

  ranking.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.displayName.replace(/\|/g, "\\|")} | ${row.id} | ${row.count} |`);
  });

  const outputDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(
    outputDir,
    `discord-top-speakers-${sanitizeFilenamePart(channel.name)}-${startDate}-to-${endDate}.md`,
  );
  fs.writeFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");

  console.log(lines.join("\n"));
  console.log(`\nSaved: ${outputFile}`);

  await client.destroy();
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
