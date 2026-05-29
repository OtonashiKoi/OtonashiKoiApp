// 列出指定頻道最近 20 則 bot 訊息的摘要
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const CHANNEL_ID = process.argv[2] || "1496800513679687701";

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise((res) => client.once("ready", res));

  const channel = await client.channels.fetch(CHANNEL_ID);
  console.log(`\n📁 #${channel.name} (${CHANNEL_ID})\n`);

  const messages = await channel.messages.fetch({ limit: 20 });
  const arr = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  for (const msg of arr) {
    const isBot = msg.author?.id === client.user.id;
    const time = new Date(msg.createdTimestamp).toISOString().slice(11, 19);
    const embedTitle = msg.embeds?.[0]?.title || "(no embed)";
    const embedFooter = msg.embeds?.[0]?.footer?.text || "";
    const buttons = msg.components?.flatMap((row) => row.components?.map((c) => c.customId || c.label || "?") || []).join(", ");
    const pinned = msg.pinned ? "📌" : " ";
    console.log(`${pinned} [${time}] ${isBot ? "🤖" : "👤"} ${msg.author?.username || "?"} | id=${msg.id}`);
    console.log(`    title: ${embedTitle.slice(0, 60)}`);
    console.log(`    footer: ${embedFooter.slice(0, 60)}`);
    if (buttons) console.log(`    buttons: ${buttons.slice(0, 100)}`);
    console.log("");
  }

  await client.destroy();
}

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
