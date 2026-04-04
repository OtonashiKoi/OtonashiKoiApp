// 直播留言指令偵測與處理器
// 偵測觀眾在直播間輸入的特定指令（打卡、查詢等）
// ------------------------------------------------

const { serviceContext, getBotClient } = require("../runtimeContext");
const config = require("../../config");
const { sendComment } = require("../onecommeSender");

// 可自訂偵測的指令關鍵字
const STREAM_COMMANDS = {
  CHECKIN: ["打卡", "+1", "check-in", "checkin"],
  QUERY:   ["查詢", "我的資料", "我的錢包"]
};

/**
 * 判斷留言是否符合某個指令群組
 * @param {string} text
 * @param {string[]} keywords
 */
function matchCommand(text, keywords) {
  const t = text.trim().toLowerCase();
  return keywords.some((kw) => t === kw.toLowerCase() || t.startsWith(kw.toLowerCase()));
}

/**
 * 處理打卡指令
 * 若玩家有資料則 log，否則略過（不強制建立）
 * @param {{ name: string, text: string, service: string, raw: object }} comment
 */
async function handleCheckin(comment) {
  const displayName = comment.name;
  const service = comment.service;
  // 嘗試以留言暱稱對應已註冊玩家（比對 displayName），若找到對應 Discord ID 則呼叫 checkinService 發放獎勵
  console.log(`[Stream] ⭐ 打卡 | ${service} | ${displayName} | "${comment.text}"`);

  try {
    const players = await serviceContext.playerRepository.listAll();
    const matched = players.find((p) => p.displayName && p.displayName.toLowerCase() === displayName.toLowerCase());
    if (!matched) {
      console.log(`[Stream] 未找到連結的玩家（displayName=${displayName}），無法自動發獎。`);
      return;
    }

    const discordId = matched.discordId;

    // 取得 guild member 並檢查是否有玩家角色
    try {
      const client = getBotClient();
      if (!client || !client.isReady()) {
        console.log("[Stream] Bot 未就緒，無法檢查 Discord 角色，略過發獎。");
        return;
      }

      if (!config.discord.guildId) {
        console.log("[Stream] 未設定 DISCORD_GUILD_ID，無法檢查成員角色，略過發獎。");
        return;
      }

      const guild = await client.guilds.fetch(config.discord.guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        console.log(`[Stream] 找不到 guild member (id=${discordId})，略過發獎。`);
        return;
      }

      const allowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(member);
      if (!allowed) {
        console.log(`[Stream] ${displayName} 並非設定的玩家身分組成員，略過發獎。`);
        return;
      }

      const result = await serviceContext.checkinService.handleMessage({
        discordId,
        displayName,
        channelId: comment.service,
        messageId: comment.id || "",
        content: comment.text,
        occurredAt: new Date().toISOString()
      });

      if (result.ok) {
        console.log(`[Stream] 打卡成功並發放 ${result.checkin.rewardDetail.amount} gold 給 ${displayName}`);
        // 回覆到直播聊天室
        try {
          const { sendComment } = require("../onecommeSender");
          const sendRes = await sendComment({ service: comment.service || "stream", displayName, comment: `${displayName} 打卡成功` });
          if (!sendRes.ok) console.warn(`[Stream] 回覆直播留言失敗：${sendRes.error}`);
        } catch (e) {
          console.warn("[Stream] 無法回覆直播留言：", e && e.message ? e.message : e);
        }
      } else if (result.reason === "already_checked_in") {
        console.log(`[Stream] ${displayName} 今日已打卡，略過發獎。`);
      }
    } catch (err) {
      console.error("[Stream] 打卡流程發生錯誤：", err && err.message ? err.message : err);
    }
  } catch (err) {
    console.error("[Stream] 打卡處理失敗：", err && err.message ? err.message : err);
  }
}

/**
 * 處理資料查詢指令（留言間接觸發）
 * @param {{ name: string, text: string, service: string }} comment
 */
async function handleQuery(comment) {
  console.log(`[Stream] 🔍 查詢指令 | ${comment.service} | ${comment.name} | "${comment.text}"`);
  // TODO: 未來可結合 Discord 用戶對應機制，返回玩家資料到 OBS 或 Discord
}

/**
 * 主要留言處理入口，由 commentFetcher 呼叫
 * @param {{ name: string, text: string, service: string, raw: object }} comment
 */
async function handleStreamComment(comment) {
  if (!comment.text) return;

  // 全部留言 log（方便監控）
  console.log(`[Stream] 💬 ${comment.service} | ${comment.name}：${comment.text}`);

  // 指令偵測
  const textLower = comment.text.trim().toLowerCase();
  if (matchCommand(comment.text, STREAM_COMMANDS.CHECKIN)) {
    await handleCheckin(comment).catch((err) =>
      console.error("[Stream] 打卡處理失敗：", err.message)
    );
    return;
  }

  if (matchCommand(comment.text, STREAM_COMMANDS.QUERY)) {
    await handleQuery(comment).catch((err) =>
      console.error("[Stream] 查詢處理失敗：", err.message)
    );
  }
}

module.exports = {
  handleStreamComment,
  STREAM_COMMANDS
};
