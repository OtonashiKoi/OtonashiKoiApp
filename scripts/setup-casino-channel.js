// 在「------音無社團遊樂園------」分類下建立「【功能】命運轉盤」頻道
// 並透過運行中的 admin API 發布面板（不開 gateway，避免搶 PM2 bot 的 token）。
require("dotenv").config();
const { REST, Routes, ChannelType } = require("discord.js");

const CHANNEL_NAME = "【功能】命運轉盤";
const PARENT_CATEGORY_ID = "1450056286921166868";
const API_BASE = `http://127.0.0.1:${process.env.API_PORT || 5566}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const TOKEN = process.env.DISCORD_BOT_TOKEN;

(async () => {
  if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN 未設定");
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  // 1) 找 guild id
  const guilds = await rest.get(Routes.userGuilds());
  if (!guilds.length) throw new Error("Bot 沒有加入任何 guild");
  const guildId = guilds[0].id;
  console.log("[setup] guildId=", guildId);

  // 2) 查現有同名頻道
  const channels = await rest.get(Routes.guildChannels(guildId));
  let channel = channels.find((c) => c.name === CHANNEL_NAME);
  if (!channel) {
    console.log("[setup] 建立頻道", CHANNEL_NAME);
    channel = await rest.post(Routes.guildChannels(guildId), {
      body: {
        name: CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent_id: PARENT_CATEGORY_ID,
        topic: "🎰 命運轉盤｜每 60 秒開獎一次，押注金幣 + 順便抽掉落（無 Boss 卡）",
      },
    });
  } else {
    console.log("[setup] 已存在頻道", channel.id, channel.name);
    if (channel.parent_id !== PARENT_CATEGORY_ID) {
      await rest.patch(Routes.channel(channel.id), { body: { parent_id: PARENT_CATEGORY_ID } });
      console.log("[setup] 已搬到分類", PARENT_CATEGORY_ID);
    }
  }
  console.log("[setup] channelId=", channel.id);

  // 3) 透過運行中的 admin API 發布面板（bot 是 PM2 那一隻在跑）
  const res = await fetch(`${API_BASE}/admin/channel-layout/publish-casino`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_PASSWORD}`,
    },
    body: JSON.stringify({ channelId: channel.id }),
  });
  const text = await res.text();
  console.log(`[setup] publish-casino HTTP ${res.status}`);
  console.log(text);
  if (!res.ok) throw new Error("發布面板失敗");
  console.log("\n✅ 完成。打開 Discord 看 #" + CHANNEL_NAME);
})().catch((err) => { console.error("[setup] failed:", err.message); process.exit(1); });
