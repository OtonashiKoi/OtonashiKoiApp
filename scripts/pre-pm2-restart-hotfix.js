require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const config = require("../src/config");
const { createServiceContext } = require("../src/services/createServiceContext");

const HOTFIX_MESSAGE =
  "📢 **官方公告**\n音無樂園要 HOTFIX 啦，請注意會斷線，請先完成目前操作。";

async function pickHotfixChannelId(serviceContext) {
  const layout = await serviceContext.adminConsoleService.getChannelLayout();
  const bindings = Array.isArray(layout?.discord?.bindings) ? layout.discord.bindings : [];
  // 對齊掉裝公告邏輯：優先 town_chat，沒有才 fallback 到 monster_zone
  const binding = bindings.find(
    (entry) => entry.featureKey === "town_chat" && entry.enabled && entry.channelId
  );
  return binding?.channelId || "";
}

async function main() {
  if (!config.discord.token) {
    console.warn("[HotfixNotice] DISCORD_TOKEN 未設定，略過重啟公告。");
    return;
  }

  const serviceContext = createServiceContext();
  const targetChannelId = await pickHotfixChannelId(serviceContext);
  if (!targetChannelId) {
    console.warn("[HotfixNotice] 找不到已啟用的聊天大街(town_chat)綁定，略過重啟公告。");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(config.discord.token);
    const channel = await client.channels.fetch(targetChannelId);
    if (!channel?.isTextBased || !channel.isTextBased()) {
      console.warn(`[HotfixNotice] 目標頻道不可發送訊息：${targetChannelId}`);
      return;
    }
    await channel.send(HOTFIX_MESSAGE);
    console.log(`[HotfixNotice] 已發送重啟公告到頻道 ${targetChannelId}`);
  } finally {
    try { client.destroy(); } catch (_) {}
  }
}

main()
  .catch((error) => {
    console.warn("[HotfixNotice] 發送失敗，但會繼續執行重啟：", error?.message || error);
  })
  .finally(() => {
    process.exit(0);
  });
