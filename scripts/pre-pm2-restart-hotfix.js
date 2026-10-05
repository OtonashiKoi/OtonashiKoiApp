"use strict";
require("dotenv").config();
const TARGET_CHANNEL_ID = "1498608950671839263";
const HOTFIX_MESSAGE = "📢 **遊戲伺服器即將重啟**\n請先完成目前操作，重啟期間會短暫斷線；恢復後請重新連線。";

async function sendRestartNotice({ token = process.env.DISCORD_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error("DISCORD_TOKEN 未設定；停止重啟，未發公告。");
  const response = await fetchImpl(`https://discord.com/api/v10/channels/${TARGET_CHANNEL_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: HOTFIX_MESSAGE, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Discord 公告發送失敗 HTTP ${response.status}；停止重啟。`);
  const message = await response.json();
  if (!message.id || message.channel_id !== TARGET_CHANNEL_ID) throw new Error("Discord 公告回應無效；停止重啟。");
  console.log(`[HotfixNotice] 已送達頻道 ${TARGET_CHANNEL_ID}，訊息 ${message.id}`);
  return message.id;
}
if (require.main === module) sendRestartNotice().catch(error => { console.error("[HotfixNotice]", error.message); process.exitCode = 1; });
module.exports = { sendRestartNotice, TARGET_CHANNEL_ID };
