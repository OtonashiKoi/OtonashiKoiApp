// 直播留言指令偵測與處理器
// 偵測觀眾在直播間輸入的特定指令（打卡、查詢等）
// ------------------------------------------------

const { serviceContext, getBotClient } = require("../runtimeContext");
const config = require("../../config");
const { sendComment } = require("../onecommeSender");
const { consumeCode } = require("../bindingStore");

// 可自訂偵測的指令關鍵字
const STREAM_COMMANDS = {
  CHECKIN: ["打卡", "簽到", "+1", "check-in", "checkin"],
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

/** 將 OneComme service 字串正規化為統一平台 key */
function normalizePlatform(service, userId) {
  const s = (service || "").toLowerCase();
  const u = (userId || "").toLowerCase();
  if (s.includes("youtube") || s === "yt") return "youtube";
  if (s.includes("twitch") || s === "tw") return "twitch";
  // service 為 unknown 時改從 userId 前綴推斷
  if (u.startsWith("tw-") || u.startsWith("twitch-")) return "twitch";
  if (u.startsWith("yt-") || u.startsWith("uc") || u.startsWith("youtube-")) return "youtube";
  return s;
}

/**
 * 處理打卡指令
 * 先以平台 userId 查玩家；找不到則退而求其次用 displayName，並自動綁定 userId
 * @param {{ id: string, name: string, userId: string, text: string, service: string, raw: object }} comment
 */
async function handleCheckin(comment) {
  const displayName = comment.name;
  const service = comment.service;
  const platformUserId = comment.userId || "";
  const platform = normalizePlatform(service, platformUserId);
  console.log(`[Stream] ⭐ 打卡 | ${service} | ${displayName} | "${comment.text}"`);

  try {
    let matched = null;

    // 1. 優先以平台 userId 精確比對（已綁定過的玩家）
    if (platformUserId) {
      matched = await serviceContext.playerRepository.findByExternalId(platform, platformUserId);
    }

    // 2. 找不到則退回 displayName 或 streamAliases 比對
    if (!matched) {
      const players = await serviceContext.playerRepository.listAll();
      const nameLower = displayName.toLowerCase();
      matched = players.find((p) => {
        if (p.displayName && p.displayName.toLowerCase() === nameLower) return true;
        if (Array.isArray(p.streamAliases) && p.streamAliases.some((a) => a.toLowerCase() === nameLower)) return true;
        return false;
      }) || null;

      // 3. 找到後自動綁定 platformUserId（供下次直接比對）
      if (matched && platformUserId && platform !== "unknown") {
        const existing = matched.externalIds || {};
        if (!existing[platform]) {
          matched.externalIds = { ...existing, [platform]: platformUserId };
          matched.updatedAt = new Date().toISOString();
          await serviceContext.playerRepository.save(matched);
          console.log(`[Stream] 🔗 自動綁定 ${displayName} ↔ ${platform}:${platformUserId}`);
        }
      }
    }

    if (!matched) {
      console.log(`[Stream] 未找到連結的玩家（displayName=${displayName}），無法自動發獎。`);
      return;
    }

    const discordId = matched.discordId;

    // 取得 guild member 並檢查是否有玩家角色
    try {
      const client = getBotClient();
      // 如果 bot 與 guild 設定存在則檢查身分組；否則記錄警告並繼續發獎
      let performRoleCheck = false;
      if (client && client.isReady() && config.discord.guildId) performRoleCheck = true;

      if (performRoleCheck) {
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
      } else {
        console.log('[Stream] Bot 未就緒或未設定 guildId，跳過 Discord 身分組檢查，將繼續發獎（請留意風險）。');
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
        const grantAmount = result.checkin.rewardDetail.amount;
        console.log(`[Stream] 打卡成功並發放 ${grantAmount} gold 給 ${displayName}`);
        // 每週任務：記錄打卡次數
        try {
          await serviceContext.weeklyQuestService.recordProgress(discordId, "checkin_count", 1);
        } catch (e) {
          console.error("[WeeklyQuest] checkin recordProgress error:", e.message);
        }
        // DM 通知玩家打卡成功
        try {
          const client = getBotClient();
          if (client?.isReady()) {
            const user = await client.users.fetch(discordId).catch(() => null);
            if (user) {
              await user.send(`✅ 打卡成功！💰 金幣 **+${grantAmount}**`);
            }
          }
        } catch (e) {
          console.warn("[Stream] 無法 DM 打卡通知：", e?.message);
        }
        // 回覆到直播聊天室
        try {
          const { sendComment } = require("../onecommeSender");
          const targetService = (platform === "youtube") ? "yt" : (platform === "twitch") ? "twitch" : comment.service || "stream";
          const sendRes = await sendComment({ service: targetService, displayName, comment: `${displayName} 打卡成功` });
          if (!sendRes.ok) console.warn(`[Stream] 回覆直播留言失敗：${sendRes.error}`);
        } catch (e) {
          console.warn("[Stream] 無法回覆直播留言：", e && e.message ? e.message : e);
        }
      } else if (result.reason === "already_checked_in") {
        console.log(`[Stream] ${displayName} 今日已打卡，略過發獎。`);
        try {
          const targetService = (platform === "youtube") ? "yt" : (platform === "twitch") ? "twitch" : comment.service || "stream";
          await sendComment({ service: targetService, displayName, comment: `${displayName} 今天打卡過囉` });
        } catch (e) {
          console.warn("[Stream] 無法回覆已打卡訊息：", e && e.message ? e.message : e);
        }
      }
    } catch (err) {
      console.error("[Stream] 打卡流程發生錯誤：", err && err.message ? err.message : err);
    }
  } catch (err) {
    console.error("[Stream] 打卡處理失敗：", err && err.message ? err.message : err);
  }
}

/**
 * 處理 !綁定 CODE 指令
 */
async function handleStreamBind(comment) {
  const rawCode = comment.text.replace(/^!+/, "").replace(/^綁定\s+/i, "").trim();
  const displayName = comment.name;
  const platformUserId = comment.userId || "";
  const platform = normalizePlatform(comment.service, platformUserId);
  console.log(`[Stream] 🔗 綁定請求 | ${comment.service} | ${displayName} | code:${rawCode}`);

  const targetService = platform === "youtube" ? "yt" : platform === "twitch" ? "twitch" : comment.service;

  const discordId = consumeCode(rawCode);
  if (!discordId) {
    try { await sendComment({ service: targetService, displayName, comment: `${displayName} 綁定碼無效或已過期，請重新在 Discord 取得綁定碼。` }); } catch { /* ignore */ }
    return;
  }

  const player = await serviceContext.playerRepository.findByDiscordId(discordId);
  if (!player) {
    try { await sendComment({ service: targetService, displayName, comment: `${displayName} 找不到對應的玩家資料。` }); } catch { /* ignore */ }
    return;
  }

  // 儲存 externalIds（有 userId 才存）
  const externalIds = { ...player.externalIds || {} };
  if (platformUserId && platform !== "unknown") {
    externalIds[platform] = platformUserId;
  }

  // 儲存 streamAliases（displayName 別名，供 unknown 平台比對使用）
  const aliases = new Set(player.streamAliases || []);
  aliases.add(displayName);

  player.externalIds = externalIds;
  player.streamAliases = [...aliases];
  player.updatedAt = new Date().toISOString();
  await serviceContext.playerRepository.save(player);

  console.log(`[Stream] ✅ 綁定成功 ${displayName} (${platform}:${platformUserId || "無userId"}) ↔ discordId:${discordId}`);
  try {
    await sendComment({ service: targetService, displayName, comment: `${displayName} 帳號綁定成功！之後打卡就能自動識別囉 🎉` });
  } catch { /* ignore */ }
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
  const rawText = comment.text || "";
  const text = rawText.trim();
  const stripped = text.replace(/^!+/, "");
  const textLower = stripped.toLowerCase();

  // 綁定指令：!綁定 CODE
  if (textLower.startsWith("綁定 ") || textLower.startsWith("綁定\t")) {
    await handleStreamBind(comment).catch((err) =>
      console.error("[Stream] 綁定處理失敗：", err.message)
    );
    return;
  }

  if (matchCommand(stripped, STREAM_COMMANDS.CHECKIN) || textLower === "打卡") {
    await handleCheckin(comment).catch((err) =>
      console.error("[Stream] 打卡處理失敗：", err.message)
    );
    return;
  }

  if (matchCommand(stripped, STREAM_COMMANDS.QUERY)) {
    await handleQuery(comment).catch((err) =>
      console.error("[Stream] 查詢處理失敗：", err.message)
    );
  }
}

module.exports = {
  handleStreamComment,
  STREAM_COMMANDS
};
