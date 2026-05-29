// Usage:
//   node scripts/discord-download-avatars.js reports/discord-top-speakers-萬事皆可聊-2026-03-01-to-2026-05-28.md
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Events } = require("discord.js");

const reportPath = process.argv[2];
const TOKEN = process.env.DISCORD_TOKEN;

function sanitizeFilenamePart(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, "_").trim();
}

function parseRankingMarkdown(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/\\\|/g, "|"));
      return {
        rank: Number(cells[0]),
        displayName: cells[1],
        discordId: cells[2],
        messageCount: Number(cells[3]),
      };
    })
    .filter((row) => row.rank && /^\d+$/.test(row.discordId));
}

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
}

async function main() {
  if (!TOKEN) throw new Error("Missing DISCORD_TOKEN");
  if (!reportPath) throw new Error("Missing report markdown path");

  const absoluteReportPath = path.resolve(process.cwd(), reportPath);
  const report = fs.readFileSync(absoluteReportPath, "utf8");
  const rows = parseRankingMarkdown(report);
  if (rows.length === 0) throw new Error(`No ranking rows found in ${absoluteReportPath}`);

  const baseName = path.basename(absoluteReportPath, path.extname(absoluteReportPath));
  const outputDir = path.join(path.dirname(absoluteReportPath), `${baseName}-avatars`);
  fs.mkdirSync(outputDir, { recursive: true });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(TOKEN);
  await new Promise((resolve) => client.once(Events.ClientReady, resolve));

  const indexLines = [
    `# Discord 頭像整理：${baseName}`,
    "",
    "| 名次 | 顯示名稱 | Discord ID | 訊息數 | 檔案 |",
    "|---:|---|---|---:|---|",
  ];

  for (const row of rows) {
    const user = await client.users.fetch(row.discordId, { force: true });
    const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: false });
    const cleanName = sanitizeFilenamePart(row.displayName || user.username || row.discordId);
    const fileName = `${String(row.rank).padStart(2, "0")}-${cleanName}-${row.discordId}.png`;
    const filePath = path.join(outputDir, fileName);
    await downloadFile(avatarUrl, filePath);

    indexLines.push(
      `| ${row.rank} | ${(row.displayName || user.username).replace(/\|/g, "\\|")} | ${row.discordId} | ${row.messageCount} | [${fileName}](./${encodeURI(fileName)}) |`,
    );
    console.log(`${row.rank}. ${row.displayName} -> ${filePath}`);
  }

  const indexPath = path.join(outputDir, "index.md");
  fs.writeFileSync(indexPath, `${indexLines.join("\n")}\n`, "utf8");
  console.log(`\nSaved index: ${indexPath}`);

  await client.destroy();
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
