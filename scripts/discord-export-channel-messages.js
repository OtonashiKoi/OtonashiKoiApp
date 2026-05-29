// Usage:
//   node scripts/discord-export-channel-messages.js "萬事皆可聊" 2026-05-01 2026-05-28
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, ChannelType, Events } = require("discord.js");

const channelNameOrId = process.argv[2] || "萬事皆可聊";
const startDate = process.argv[3] || "2026-05-01";
const endDate = process.argv[4] || "2026-05-28";

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
  return String(text).replace(/[\\/:*?"<>|]/g, "_").trim();
}

function escapeMarkdownCell(text) {
  return String(text || "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

async function resolveChannel(client) {
  if (!GUILD_ID) throw new Error("Missing DISCORD_GUILD_ID");

  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();
  const byId = channels.get(channelNameOrId);
  if (byId) return byId;

  const normalized = channelNameOrId.replace(/^#/, "").trim();
  const matches = [...channels.values()].filter((ch) => {
    if (!ch || ch.name !== normalized) return false;
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

function serializeMessage(msg) {
  return {
    id: msg.id,
    channelId: msg.channelId,
    createdAt: formatTaiwan(msg.createdTimestamp),
    createdTimestamp: msg.createdTimestamp,
    author: {
      id: msg.author?.id || "",
      username: msg.author?.username || "",
      globalName: msg.author?.globalName || "",
      displayName: msg.member?.displayName || msg.author?.globalName || msg.author?.username || "",
      bot: Boolean(msg.author?.bot),
    },
    content: msg.content || "",
    cleanContent: msg.cleanContent || "",
    attachments: [...(msg.attachments?.values?.() || [])].map((att) => ({
      id: att.id,
      name: att.name,
      url: att.url,
      contentType: att.contentType,
      size: att.size,
    })),
    embeds: (msg.embeds || []).map((embed) => ({
      title: embed.title || "",
      description: embed.description || "",
      url: embed.url || "",
      author: embed.author?.name || "",
      footer: embed.footer?.text || "",
    })),
    reference: msg.reference || null,
  };
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

  const messages = [];
  let before;
  let fetchedTotal = 0;
  let batchCount = 0;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    batchCount += 1;
    const rows = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    fetchedTotal += rows.length;

    for (const msg of rows) {
      before = msg.id;
      if (msg.createdTimestamp > endMs) continue;
      if (msg.createdTimestamp < startMs) continue;
      messages.push(serializeMessage(msg));
    }

    const oldest = rows[rows.length - 1].createdTimestamp;
    if (batchCount % 10 === 0) {
      console.error(`[progress] batches=${batchCount}, fetched=${fetchedTotal}, kept=${messages.length}, oldest=${formatTaiwan(oldest)}`);
    }
    if (oldest < startMs) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const outputDir = path.join(process.cwd(), "reports", `discord-export-${sanitizeFilenamePart(channel.name)}-${startDate}-to-${endDate}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonlPath = path.join(outputDir, "messages.jsonl");
  fs.writeFileSync(jsonlPath, messages.map((msg) => JSON.stringify(msg)).join("\n") + "\n", "utf8");

  const markdownPath = path.join(outputDir, "messages.md");
  const markdownLines = [
    `# Discord 對話匯出：#${channel.name}`,
    "",
    `- 統計區間：${startDate} 00:00:00 至 ${endDate} 23:59:59（Asia/Taipei, UTC+8）`,
    `- 頻道：#${channel.name} (${channel.id})`,
    `- 匯出訊息數：${messages.length}`,
    `- 產生時間：${formatTaiwan(Date.now())}`,
    "",
    "| 時間 | 顯示名稱 | Discord ID | 訊息 | 附件數 | Embed 數 |",
    "|---|---|---|---|---:|---:|",
  ];

  for (const msg of messages) {
    const content = msg.cleanContent || msg.content || (msg.attachments.length ? "[附件]" : "") || (msg.embeds.length ? "[Embed]" : "");
    markdownLines.push(
      `| ${msg.createdAt} | ${escapeMarkdownCell(msg.author.displayName)} | ${msg.author.id} | ${escapeMarkdownCell(content)} | ${msg.attachments.length} | ${msg.embeds.length} |`,
    );
  }
  fs.writeFileSync(markdownPath, `${markdownLines.join("\n")}\n`, "utf8");

  const summaryPath = path.join(outputDir, "summary.md");
  const jsonlSize = fs.statSync(jsonlPath).size;
  const markdownSize = fs.statSync(markdownPath).size;
  fs.writeFileSync(
    summaryPath,
    [
      `# Discord 對話匯出摘要：#${channel.name}`,
      "",
      `- 區間：${startDate} 至 ${endDate}（Asia/Taipei, UTC+8）`,
      `- 訊息數：${messages.length}`,
      `- 掃描訊息數：${fetchedTotal}`,
      `- JSONL：messages.jsonl (${jsonlSize} bytes)`,
      `- Markdown：messages.md (${markdownSize} bytes)`,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`Exported ${messages.length} messages`);
  console.log(`Directory: ${outputDir}`);
  console.log(`JSONL: ${jsonlPath} (${jsonlSize} bytes)`);
  console.log(`Markdown: ${markdownPath} (${markdownSize} bytes)`);
  console.log(`Summary: ${summaryPath}`);

  await client.destroy();
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
