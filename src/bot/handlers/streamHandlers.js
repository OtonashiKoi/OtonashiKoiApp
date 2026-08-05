// 直播留言指令偵測與處理器
// 偵測觀眾在直播間輸入的特定指令（打卡、查詢等）
// ------------------------------------------------

const { serviceContext, getBotClient } = require("../runtimeContext");
const config = require("../../config");
const { sendComment } = require("../onecommeSender");
const { consumeCode } = require("../bindingStore");
const { recordComment } = require("../../services/stream/streamPresence");
const { joinQueue } = require("../../services/mahjong/mahjongQueue");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { recordDonationEvent } = require("../../services/stream/streamRecordsService");

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
  const t = text.trim().replace(/^[!！/]+/, "").trim().toLowerCase();
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

function normalizeStreamName(name) {
  return String(name || "").trim().toLowerCase();
}

function summarizeBadges(badges) {
  if (!badges) return "none";
  if (Array.isArray(badges)) {
    return badges
      .map((badge) => {
        if (!badge) return "";
        if (typeof badge === "string") return badge;
        if (typeof badge === "object") return badge.name || badge.label || badge.id || badge.type || "";
        return String(badge);
      })
      .filter(Boolean)
      .join("|") || "none";
  }
  if (typeof badges === "object") {
    return Object.entries(badges)
      .map(([key, value]) => {
        if (value === true) return key;
        if (value && typeof value === "object") return value.name || value.label || value.id || key;
        return `${key}:${String(value)}`;
      })
      .filter(Boolean)
      .join("|") || "none";
  }
  return String(badges);
}

function extractBadgeLabels(badges) {
  if (!badges) return [];
  if (Array.isArray(badges)) {
    return badges
      .map((badge) => {
        if (!badge) return "";
        if (typeof badge === "string") return badge;
        if (typeof badge === "object") return badge.label || badge.title || badge.name || badge.id || badge.type || "";
        return String(badge);
      })
      .filter(Boolean);
  }
  if (typeof badges === "object") {
    return Object.values(badges)
      .map((badge) => {
        if (!badge) return "";
        if (typeof badge === "string") return badge;
        if (typeof badge === "object") return badge.label || badge.title || badge.name || badge.id || badge.type || "";
        return String(badge);
      })
      .filter(Boolean);
  }
  return [String(badges)];
}

function inferOneCommeMembershipTier(raw = {}) {
  if (!raw || raw.isMember !== true) return null;
  const badgesText = summarizeBadges(raw.badges);
  if (/#3\b/.test(badgesText)) {
    return { tier: "B", label: "鯉長", badge: "#3" };
  }
  return null;
}

function inferStreamSupportSnapshot(comment) {
  const raw = comment?.raw || {};
  const platform = normalizePlatform(comment?.service, comment?.userId || raw.userId || "");
  const badgeLabels = extractBadgeLabels(raw.badges);
  const badgeText = badgeLabels.join("|");

  if (platform === "youtube") {
    const isMember = raw.isMember === true || /會員/.test(badgeText);
    return {
      platform,
      supportKind: isMember ? "member" : null,
      supportLabel: badgeText || (isMember ? "member" : null),
      supportDetected: isMember
    };
  }

  if (platform === "twitch") {
    const isSubscriber = raw.subscriber === "1" || /訂閱者/i.test(badgeText);
    return {
      platform,
      supportKind: isSubscriber ? "subscriber" : null,
      supportLabel: badgeText || (isSubscriber ? "subscriber" : null),
      supportDetected: isSubscriber
    };
  }

  return {
    platform,
    supportKind: null,
    supportLabel: badgeText || null,
    supportDetected: false
  };
}

function buildEffectiveSupportSnapshot(snapshot, platform, playerTierAtLink, rawBadges) {
  const badgeLabels = extractBadgeLabels(rawBadges);
  if (snapshot?.supportDetected) {
    return {
      supportDetected: true,
      supportKind: snapshot.supportKind,
      badgeLabels,
    };
  }

  if ((platform === "youtube" || platform === "twitch") && playerTierAtLink) {
    return {
      supportDetected: true,
      supportKind: platform === "youtube" ? "member" : "subscriber",
      badgeLabels: [...badgeLabels, `Discord身分組:${playerTierAtLink}`],
    };
  }

  return {
    supportDetected: false,
    supportKind: null,
    badgeLabels,
  };
}

function parsePositiveNumber(value) {
  const text = String(value ?? "").replace(/,/g, "");
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── 外幣 → 台幣換算（2026-08-04 使用者定案：日幣 ÷5；其餘常見幣別用粗略固定匯率）──
// 背景：harkun ¥5000 被當 NT$5000 記錄，灌爆累計金額（見 memory: stream-donation-currency-bug）。
// 固定匯率就好——斗內金額本來就是粗粒度（每 NT$100 = 1 鑽），不需要即時匯率的精度。
const TWD_PER_UNIT = {
  TWD: 1, NTD: 1,
  JPY: 0.2,          // ¥5 = NT$1（使用者定案「日幣 /5」）
  USD: 30, MYR: 7, HKD: 4, KRW: 0.022, EUR: 33, GBP: 38,
  SGD: 23, PHP: 0.55, THB: 0.9, CNY: 4.2, AUD: 20, CAD: 22,
};
/**
 * 判定幣別。優先看 raw.currency 的明確代碼/符號；再從顯示文字嗅探。
 * ⚠️ 單獨的「$」一律視為台幣：台灣觀眾為主，YT 的 NT$ 常被 OneComme 縮成 $，
 *    當美金會 ×30 爆炸（2026-07-25 的 $30/$75 實證就是台幣）。要當美金必須明寫 USD/US$。
 */
function sniffDonationCurrency(rawCurrency, text) {
  const c = String(rawCurrency || "").toUpperCase().trim();
  if (["TWD", "NTD", "NT$", "TWD$", "$"].includes(c)) return "TWD";
  if (TWD_PER_UNIT[c]) return c;
  if (c === "¥" || c === "￥") return "JPY";
  if (c === "₩") return "KRW";
  if (c === "€") return "EUR";
  if (c === "£") return "GBP";
  const t = String(text || "").toUpperCase();
  if (/NT\$|TWD|NTD|新台幣|台幣/.test(t)) return "TWD";
  if (/JPY|[¥￥円]/.test(t)) return "JPY";
  if (/US\$|USD/.test(t)) return "USD";
  if (/MYR|(^|\s)RM\d/.test(t)) return "MYR";
  if (/HK\$|HKD/.test(t)) return "HKD";
  if (/KRW|₩/.test(t)) return "KRW";
  if (/EUR|€/.test(t)) return "EUR";
  if (/GBP|£/.test(t)) return "GBP";
  if (/SG\$|SGD/.test(t)) return "SGD";
  return "TWD";
}

function inferDonationReward(comment) {
  const raw = comment?.raw || {};
  const platform = normalizePlatform(comment?.service, comment?.userId || raw.userId || "");
  if (platform !== "youtube") return null; // 目前先只做 YouTube 斗內
  if (raw.isTest === true || raw.test === true) return null;

  const rawType = String(raw.type || raw.payload?.type || "").toLowerCase();
  const amountCandidates = [
    raw.amount,
    raw.amountValue,
    raw.purchaseAmount,
    raw.price
  ];
  const amount = amountCandidates.map(parsePositiveNumber).find((n) => n > 0) || 0;
  const currency = String(raw.currency || "").toUpperCase();
  const displayString = String(raw.displayString || raw.comment || raw.message || comment?.text || "");
  const textForCurrency = `${currency} ${displayString}`.toUpperCase();
  const looksLikeDonation =
    rawType === "superchat" ||
    raw.isSuperChat === true ||
    raw.isPaid === true ||
    raw.hasDonation === true ||
    raw.isDonation === true ||
    amount > 0 ||
    /NT\$|TWD|NTD|新台幣|台幣/.test(textForCurrency);

  if (!looksLikeDonation) return null;

  const looksLikeTwd =
    /NT\$|TWD|NTD|新台幣|台幣/.test(textForCurrency) ||
    currency === "TWD" ||
    currency === "NTD" ||
    currency === "NT$" ||
    currency === "TWD$" ||
    rawType === "superchat" ||
    raw.isSuperChat === true ||
    raw.isPaid === true ||
    raw.hasDonation === true ||
    raw.isDonation === true ||
    amount > 0;

  if (!looksLikeTwd) return null;

  const rawAmount = amount > 0 ? amount : parsePositiveNumber(displayString);
  if (!rawAmount) return null;

  // 外幣換算：¥5000 → NT$1000（÷5）；台幣與未知幣別維持原值
  const detectedCurrency = sniffDonationCurrency(currency, `${raw.paidText || ""} ${displayString}`);
  const twdRate = TWD_PER_UNIT[detectedCurrency] || 1;
  const twdAmount = Math.max(1, Math.round(rawAmount * twdRate));
  if (detectedCurrency !== "TWD") {
    console.log(`[Donation] 💱 外幣換算：${detectedCurrency} ${rawAmount} → NT$${twdAmount}（匯率 ${twdRate}）`);
  }

  // 小額（<100）不再提前丟棄：下游台帳本來就會累積零頭、記錄層設計就是「未滿百也完整保存」。
  // 舊的 `diamondAmount <= 0 → return null` 讓小額 SC 連記錄和警報都消失（2026-07-25 直播 $30/$75 實證）。
  const diamondAmount = Math.floor(twdAmount / 100);

  const sourceId = String(
    raw._id ||
    raw.hash ||
    raw.createdAtTimestamp ||
    raw.createdAt ||
    comment?.id ||
    ""
  ).trim();

  return {
    platform,
    platformUserId: comment?.userId || raw.userId || "",
    displayName: comment?.name || raw.displayName || raw.name || "未知用戶",
    twdAmount,
    diamondAmount,
    // 外幣資訊（記錄層用；台幣時 originalCurrency 也是 TWD、originalAmount = twdAmount）
    originalCurrency: detectedCurrency,
    originalAmount: rawAmount,
    sourceRef: `youtube:${sourceId || `${comment?.userId || raw.userId || "unknown"}:${twdAmount}:${displayString}`}`,
    donationLabel: raw.displayString || raw.message || displayString
  };
}

async function findPlayersByDisplayName(displayName) {
  const target = normalizeStreamName(displayName);
  if (!target) return [];
  const players = await serviceContext.playerRepository.listAll();
  return players.filter((player) => {
    if (!player || !player.discordId) return false;
    if (normalizeStreamName(player.displayName) === target) return true;
    if (Array.isArray(player.streamAliases) && player.streamAliases.some((alias) => normalizeStreamName(alias) === target)) return true;
    return false;
  });
}

async function sendDiscordDm(discordId, content) {
  try {
    const client = getBotClient();
    if (!client?.isReady()) return false;
    const user = await client.users.fetch(discordId).catch(() => null);
    if (!user) return false;
    await user.send(content);
    return true;
  } catch (error) {
    console.warn(`[Stream] DM 發送失敗 (${discordId}):`, error?.message || error);
    return false;
  }
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

  try {
    let matched = null;

    // 1. 優先以平台 userId 精確比對（已綁定過的玩家）
    if (platformUserId) {
      matched = await serviceContext.playerRepository.findByExternalId(platform, platformUserId);
    }

    // 2. 找不到則退回 displayName 或 streamAliases 比對
    if (!matched) {
      const nameMatches = await findPlayersByDisplayName(displayName);
      if (nameMatches.length === 1) {
        matched = nameMatches[0];
      } else if (nameMatches.length > 1) {
        console.warn(`[Stream] 顯示名稱比對到多個玩家，略過自動綁定/發獎：${displayName}`);
        return;
      }

      // 3. 找到後自動綁定 platformUserId（供下次直接比對）
      if (matched && platformUserId && platform !== "unknown") {
        const bindingRepo = serviceContext.streamAccountBindingRepository;
        const existingBinding = bindingRepo
          ? await bindingRepo.findByPlatformAndUserId(platform, platformUserId).catch(() => null)
          : null;
        if (!existingBinding) {
          try {
            await bindingRepo?.save({
              platform,
              platformUserId,
              discordId: matched.discordId,
              displayName: matched.displayName || displayName,
              linkedAt: new Date().toISOString()
            });
          } catch (bindErr) {
            if (bindErr?.code === 11000) {
              console.warn(`[Stream] 自動綁定衝突：${platform}:${platformUserId} 已被其他 Discord 使用`);
            } else {
              console.warn(`[Stream] 自動綁定失敗：${bindErr?.message || bindErr}`);
            }
          }
        }
      }
    }

    if (!matched) {
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
          return;
        }

        const allowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(member);
        if (!allowed) {
          return;
        }
      } else {
      }

      const result = await serviceContext.checkinService.handleMessage({
        discordId,
        displayName,
        channelId: comment.service,
        messageId: comment.id || "",
        content: comment.text,
        occurredAt: new Date().toISOString(),
        platform,
        platformUserId
      });

      if (result.ok) {
        const grantAmount = result.checkin.rewardDetail.amount;
        // SSE 推送打卡獎勵到 web 端通知
        try {
          if (typeof serviceContext._pushRewardToPlayer === "function") {
            serviceContext._pushRewardToPlayer(discordId, {
              monsterName: "每日打卡",
              gold: grantAmount,
              exp: 0,
              levelUps: 0,
              drops: [],
            });
          }
        } catch (_) {}
        // 每週任務：記錄打卡次數
        try {
          await serviceContext.weeklyQuestService.recordProgress(discordId, "checkin_count", 1);
        } catch (e) {
          console.error("[WeeklyQuest] checkin recordProgress error:", e.message);
        }
        // DM 通知玩家打卡成功
        try {
          const client = getBotClient();
          if (!client?.isReady()) {
            console.warn("[Stream] DM 跳過：bot 未就緒");
          } else {
            const user = await client.users.fetch(discordId).catch((e) => { console.warn("[Stream] DM fetch user 失敗:", e?.message); return null; });
            if (user) {
              try {
                await user.send(`✅ 打卡成功！💰 金幣 **+${grantAmount}**`);
              } catch (sendErr) {
                console.warn(`[Stream] DM send 失敗 (${discordId}):`, sendErr?.message, sendErr?.code);
              }
            } else {
              console.warn(`[Stream] DM 跳過：找不到 Discord user (${discordId})`);
            }
          }
        } catch (e) {
          console.warn("[Stream] 無法 DM 打卡通知：", e?.message, e?.code);
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
        try {
          const targetService = (platform === "youtube") ? "yt" : (platform === "twitch") ? "twitch" : comment.service || "stream";
          await sendComment({ service: targetService, displayName, comment: `${displayName} 今天打卡過囉` });
        } catch (e) {
          console.warn("[Stream] 無法回覆已打卡訊息：", e && e.message ? e.message : e);
        }
      } else if (result.reason === "already_checked_in_platform") {
        try {
          const targetService = (platform === "youtube") ? "yt" : (platform === "twitch") ? "twitch" : comment.service || "stream";
          await sendComment({ service: targetService, displayName, comment: `${displayName} 這個帳號今天已經打卡過囉` });
        } catch (e) {
          console.warn("[Stream] 無法回覆平台已打卡訊息：", e && e.message ? e.message : e);
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
  const normalizedText = comment.text.replace(/^[!！/]+/, "").trim();
  const isVerifyCommand = /^驗證(\s|$)/i.test(normalizedText);
  const rawCode = normalizedText.replace(/^(綁定|驗證)\s+/i, "").trim();
  const displayName = comment.name;
  const platformUserId = comment.userId || "";
  const platform = normalizePlatform(comment.service, platformUserId);

  const targetService = platform === "youtube" ? "yt" : platform === "twitch" ? "twitch" : comment.service;
  const platformLabel = platform === "youtube" ? "YouTube" : platform === "twitch" ? "Twitch" : platform;
  const actionLabel = isVerifyCommand ? "驗證" : "綁定";
  const discordId = consumeCode(rawCode);
  if (!discordId) {
    try { await sendComment({ service: targetService, displayName, comment: `${displayName} ${actionLabel}碼無效或已過期，請重新在 Discord 取得驗證碼。` }); } catch { /* ignore */ }
    return;
  }

  const notifyFailure = async (message, dmMessage) => {
    try {
      await sendComment({ service: targetService, displayName, comment: `${displayName} ${message}` });
    } catch { /* ignore */ }
    try {
      if (discordId) {
        await sendDiscordDm(discordId, dmMessage || `❌ ${message}`);
      }
    } catch { /* ignore */ }
  };

  const player = await serviceContext.playerRepository.findByDiscordId(discordId);
  if (!player) {
    await notifyFailure("找不到對應的玩家資料。", "❌ 找不到對應的玩家資料。");
    return;
  }

  let playerTierAtLink = null;
  let memberRoleIdsAtLink = [];
  const supportSnapshot = inferStreamSupportSnapshot(comment);
  try {
    const inferredStreamTier = inferOneCommeMembershipTier(comment.raw || {});
    if (inferredStreamTier) {
      playerTierAtLink = inferredStreamTier.tier;
    }

    const client = getBotClient();
    if (client?.isReady() && config.discord.guildId) {
      const guild = await client.guilds.fetch(config.discord.guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (member) {
        memberRoleIdsAtLink = member.roles.cache.map((r) => r.id);
        const discordTier = await serviceContext.playerTierService.resolveHighestTier(memberRoleIdsAtLink).catch(() => null);
        if (!playerTierAtLink && discordTier) playerTierAtLink = discordTier;
      } else {
      }
    } else {
    }
  } catch (tierErr) {
    console.warn("[Stream] 綁定時解析會員等級失敗：", tierErr?.message || tierErr);
  }
  const effectiveSupportSnapshot = buildEffectiveSupportSnapshot(
    supportSnapshot,
    platform,
    playerTierAtLink,
    comment.raw?.badges
  );

  const bindingRepo = serviceContext.streamAccountBindingRepository;
  if (!bindingRepo) {
    await notifyFailure("綁定服務尚未就緒，請稍後再試。", "❌ 綁定服務尚未就緒，請稍後再試。");
    return;
  }

  const existingForDiscord = await bindingRepo.findByDiscordAndPlatform(discordId, platform).catch(() => null);
  if (existingForDiscord && existingForDiscord.platformUserId !== platformUserId) {
    await notifyFailure(`你的 ${platformLabel} 已經綁定過，無法更換帳號。`, `❌ 你的 ${platformLabel} 已經綁定過，無法更換帳號。`);
    return;
  }

  if (platformUserId && platform !== "unknown") {
    const existingBinding = await bindingRepo.findByPlatformAndUserId(platform, platformUserId).catch(() => null);
    if (existingBinding && existingBinding.discordId !== discordId) {
      await notifyFailure("該帳號已綁定其他DC", "❌ 該帳號已綁定其他DC");
      return;
    }
  }

  if (existingForDiscord && existingForDiscord.platformUserId === platformUserId) {
    try {
      await bindingRepo.save({
        platform,
        platformUserId,
        discordId,
        displayName: player.displayName || displayName,
        linkedAt: existingForDiscord.linkedAt || new Date().toISOString(),
        playerTierAtLink,
        memberRoleIdsAtLink,
        linkedSupportAtLink: effectiveSupportSnapshot.supportDetected,
        linkedSupportKindAtLink: effectiveSupportSnapshot.supportKind,
        linkedSupportBadgeLabelsAtLink: effectiveSupportSnapshot.badgeLabels
      });
    } catch (err) {
      console.warn("[Stream] 綁定更新失敗（同帳號覆寫）:", err?.message || err);
    }
    if (playerTierAtLink) {
      try {
        const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
        if (progress && progress.playerTier !== playerTierAtLink) {
          progress.playerTier = playerTierAtLink;
          progress.updatedAt = new Date().toISOString();
          await serviceContext.progressRepository.save(progress);
        }
      } catch (tierErr) {
        console.warn("[Stream] 綁定後同步 playerTier 失敗：", tierErr?.message || tierErr);
      }
    }
    try {
      const questService = serviceContext.questService || serviceContext.weeklyQuestService;
      await questService.recordProgress(discordId, "stream_bind_count", 1);
    } catch (e) {
      console.error("[Quest] stream bind recordProgress error:", e.message);
    }
    try {
      await sendComment({ service: targetService, displayName, comment: `${displayName} ${platformLabel} 帳號已${actionLabel}完成。` });
    } catch { /* ignore */ }
    try {
      await sendDiscordDm(discordId, `✅ 你的 ${platformLabel} 已經${actionLabel}完成。`);
    } catch { /* ignore */ }
    return;
  }

  if (!platformUserId || platform === "unknown") {
    await notifyFailure("目前無法辨識這個平台帳號，請確認你是從 YouTube / Twitch 綁定。", "❌ 目前無法辨識這個平台帳號，請確認你是從 YouTube / Twitch 綁定。");
    return;
  }

  try {
    await bindingRepo.save({
      platform,
      platformUserId,
      discordId,
      displayName: player.displayName || displayName,
      linkedAt: existingForDiscord?.linkedAt || new Date().toISOString(),
      playerTierAtLink,
      memberRoleIdsAtLink,
      linkedSupportAtLink: effectiveSupportSnapshot.supportDetected,
      linkedSupportKindAtLink: effectiveSupportSnapshot.supportKind,
      linkedSupportBadgeLabelsAtLink: effectiveSupportSnapshot.badgeLabels
    });
  } catch (err) {
    if (err?.code === 11000) {
      await notifyFailure("該帳號已綁定其他DC", "❌ 該帳號已綁定其他DC");
      return;
    }
    console.error("[Stream] 綁定寫入失敗：", err?.message || err);
    await notifyFailure("綁定寫入失敗，請稍後再試。", "❌ 綁定寫入失敗，請稍後再試。");
    return;
  }

  if (playerTierAtLink) {
    try {
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (progress && progress.playerTier !== playerTierAtLink) {
        progress.playerTier = playerTierAtLink;
        progress.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(progress);
      }
    } catch (tierErr) {
      console.warn("[Stream] 綁定後同步 playerTier 失敗：", tierErr?.message || tierErr);
    }
  }

  try {
    const questService = serviceContext.questService || serviceContext.weeklyQuestService;
    await questService.recordProgress(discordId, "stream_bind_count", 1);
  } catch (e) {
    console.error("[Quest] stream bind recordProgress error:", e.message);
  }

  try {
    await sendComment({ service: targetService, displayName, comment: `${displayName} 帳號已${actionLabel}成功！之後打卡就能自動識別囉 🎉` });
  } catch { /* ignore */ }
  try {
    await sendDiscordDm(discordId, `✅ 你的 ${platformLabel} 已${actionLabel}成功！`);
  } catch { /* ignore */ }
}

/**
 * 處理直播斗內（目前先支援 YouTube SuperChat）
 * @param {{ id: string, name: string, userId: string, text: string, service: string, raw: object }} comment
 */
async function handleDonation(comment) {
  const raw = comment?.raw || {};
  const rawType = String(raw.type || raw.payload?.type || "").toLowerCase();
  const looksLikeSC = rawType === "superchat" || raw.isSuperChat === true || raw.isPaid === true || raw.hasDonation === true || raw.isDonation === true;
  // 幣別診斷：放寬觸發——只要有任何付費跡象就 dump 完整 raw（不限 superchat 旗標）。
  // 因為外幣/小額 SC 可能沒設 isSuperChat、或金額在非預期欄位，用嚴格條件會漏抓。可日後移除。
  const paidish = looksLikeSC
    || raw.hasGift === true || raw.giftType != null
    || [raw.amount, raw.amountValue, raw.purchaseAmount, raw.price].some((v) => parsePositiveNumber(v) > 0)
    || (raw.paidText != null && raw.paidText !== "")
    || (raw.unit != null && raw.unit !== "")
    || /[¥$₩฿€£]|MYR|RM|USD|JPY|HKD|KRW|SGD|TWD|NT\$/i.test(String(raw.displayString || raw.comment || comment?.text || ""));
  if (paidish) {
    console.log(`[Donation] SC 事件收到：userId=${comment?.userId} name=${comment?.name} type=${rawType} amount=${raw.purchaseAmount ?? raw.amount ?? raw.price ?? "?"} currency=${raw.currency} unit=${raw.unit} paidText=${raw.paidText} displayString=${raw.displayString}`);
    try {
      console.log(`[Donation] 🔎幣別診斷 rawKeys=${Object.keys(raw).join(",")}`);
      console.log(`[Donation] 🔎幣別診斷 完整raw=${JSON.stringify(raw).slice(0, 1500)}`);
    } catch (_) { /* noop */ }
  }

  const donation = inferDonationReward(comment);
  if (!donation) {
    if (looksLikeSC) {
      console.log(`[Donation] SC 識別失敗，略過：userId=${comment?.userId} platform=${normalizePlatform(comment?.service, comment?.userId || "")} twdAmount=${raw.purchaseAmount ?? raw.amount ?? 0}`);
    }
    return false;
  }

  // 斗內事件記錄用的共同欄位（記錄層 best-effort，與發鑽流程解耦）
  const support = inferStreamSupportSnapshot(comment);
  const donationEventBase = {
    sourceRef: donation.sourceRef,
    platform: donation.platform,
    platformUserId: donation.platformUserId,
    displayName: donation.displayName,
    twdAmount: donation.twdAmount,
    currency: donation.originalCurrency || String(raw.currency || "").toUpperCase() || null,
    originalAmount: donation.originalAmount ?? donation.twdAmount,   // 外幣原始金額（¥5000 之類）；台幣＝twdAmount
    isMember: support.supportDetected,
    supportKind: support.supportKind || null
  };

  const bindingPlayer = await serviceContext.playerRepository.findByExternalId(donation.platform, donation.platformUserId).catch(() => null);
  if (!bindingPlayer?.discordId) {
    console.log(`[Donation] 未找到綁定玩家，略過發放：platform=${donation.platform} userId=${donation.platformUserId} amount=${donation.twdAmount}`);
    await recordDonationEvent({ ...donationEventBase, bound: false, discordId: null, diamondsGranted: 0, note: "unbound" }).catch(() => {});
    return false;
  }

  const discordId = bindingPlayer.discordId;
  const displayName = bindingPlayer.displayName || donation.displayName;

  // 累積台帳：累積未達 100 台幣的零頭
  const db = (await getMongoDb().catch(() => null));
  if (!db) {
    console.error("[Donation] 無法取得 DB 連線");
    return false;
  }
  const ledger = await db.collection("donationLedger").findOne({ discordId }) || { pendingTwd: 0, totalTwd: 0, processedRefs: [] };

  // 冪等：同一筆斗內事件（sourceRef）若已處理過就略過，避免事件重觸發導致台帳重複累計
  const processedRefs = Array.isArray(ledger.processedRefs) ? ledger.processedRefs : [];
  if (donation.sourceRef && processedRefs.includes(donation.sourceRef)) {
    console.log(`[Donation] 事件已處理過，略過：${displayName} sourceRef=${donation.sourceRef}`);
    return true;
  }

  // 直播連動事件觸發（確認是全新斗內事件後、發鑽前）— best-effort，不影響發鑽
  //   1) 斗內觸發全服 Buff（達門檻）
  //   2) SC 累積條 +金額（達里程碑則解鎖）
  try {
    await require("../../services/stream/donationBuffTrigger").maybeTriggerDonationBuff(donation, { discordId, displayName }, serviceContext);
  } catch (_) { /* noop */ }
  try {
    await require("../../services/stream/scBarService").addDonation(donation.twdAmount, { discordId, displayName }, serviceContext);
  } catch (_) { /* noop */ }

  const newPendingRaw = (ledger.pendingTwd || 0) + donation.twdAmount;
  const diamondsToGrant = Math.floor(newPendingRaw / 100);
  const newPending = newPendingRaw % 100;
  const newTotal = (ledger.totalTwd || 0) + donation.twdAmount;
  const now = new Date().toISOString();
  // 只保留最近 200 筆已處理事件，避免無限增長
  const nextRefs = donation.sourceRef ? [...processedRefs, donation.sourceRef].slice(-200) : processedRefs;

  // 台帳寫入抽成函式：務必在「確認發鑽成功（或無需發鑽）」之後才呼叫，避免發放失敗卻已消耗零頭
  const persistLedger = () => db.collection("donationLedger").updateOne(
    { discordId },
    { $set: { discordId, pendingTwd: newPending, totalTwd: newTotal, processedRefs: nextRefs, updatedAt: now } },
    { upsert: true }
  );

  if (diamondsToGrant <= 0) {
    await persistLedger();
    console.log(`[Donation] 台帳更新 ${displayName}：+TWD${donation.twdAmount} 累積=${newPendingRaw} 發鑽=0 剩餘=${newPending}`);
    await recordDonationEvent({ ...donationEventBase, displayName, bound: true, discordId, diamondsGranted: 0, pendingAfter: newPending, note: "accumulate" }).catch(() => {});
    await sendDiscordDm(discordId, `💎 感謝你的 NT$${donation.twdAmount} 斗內！累積 NT$${newPendingRaw} 中（還差 NT$${100 - newPendingRaw} 達到 1 顆鑽石）`).catch(() => {});
    return true;
  }

  try {
    const result = await serviceContext.rewardService.grantCurrency({
      discordId,
      displayName,
      currencyType: "diamond",
      amount: diamondsToGrant,
      source: CURRENCY_SOURCES.DONATION_REWARD,
      sourceRef: donation.sourceRef,
      operator: "stream:donation"
    });

    // 發放成功（grantCurrency 以 sourceRef 冪等）後才寫台帳，失敗則零頭保留、下次重試
    await persistLedger();
    console.log(`[Donation] 台帳更新 ${displayName}：+TWD${donation.twdAmount} 累積=${newPendingRaw} 發鑽=${diamondsToGrant} 剩餘=${newPending}`);
    await recordDonationEvent({ ...donationEventBase, displayName, bound: true, discordId, diamondsGranted: diamondsToGrant, pendingAfter: newPending, note: "granted" }).catch(() => {});

    const duplicate = Boolean(result.duplicated);
    if (duplicate) {
      console.log(`[Donation] 重複發放，略過：${displayName} sourceRef=${donation.sourceRef}`);
    } else {
      console.log(`[Donation] 發放完成 ${displayName} TWD=${donation.twdAmount} -> 💎 ${diamondsToGrant}（剩餘未結算 NT$${newPending}）`);
      const pendingMsg = newPending > 0 ? `，剩餘 NT$${newPending} 累積中` : "";
      await sendDiscordDm(discordId, `💎 感謝你的 NT$${donation.twdAmount} 斗內！已獲得 **${diamondsToGrant}** 顆鑽石${pendingMsg}`).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error("[Donation] 發放失敗（台帳未變動，下次重試）：", err?.message || err);
    return false;
  }
}

/**
 * 處理資料查詢指令（留言間接觸發）
 * @param {{ name: string, text: string, service: string }} comment
 */
async function handleQuery(comment) {
  // TODO: 未來可結合 Discord 用戶對應機制，返回玩家資料到 OBS 或 Discord
}

/**
 * 主要留言處理入口，由 commentFetcher 呼叫
 * @param {{ name: string, text: string, service: string, raw: object }} comment
 */
async function handleStreamComment(comment) {
  if (comment.raw?._onecommeHistory) return;

  // 直播警報事件偵測（Twitch 訂閱/Raid、YT 會員加入）→ alert.html 用；不影響主流程
  try { require("../../services/stream/streamAlertService").ingestComment(comment); } catch (_) {}

  // 斗內事件：不受 text 限制（SC 可能沒有留言文字）
  if (await handleDonation(comment).catch((err) => {
    console.error("[Donation] 處理失敗：", err?.message || err);
    return false;
  })) {
    return;
  }

  if (!comment.text) return;
  const streamSnapshot = recordComment(comment);
  if (typeof serviceContext._pushStreamPresence === "function") {
    try {
      serviceContext._pushStreamPresence(streamSnapshot);
    } catch (_) {}
  }

  // 指令偵測
  const rawText = comment.text || "";
  const text = rawText.trim();
  const stripped = text.replace(/^[!！/]+/, "").trim();
  const textLower = stripped.toLowerCase();

  // 日麻排隊：++
  if (text === "++" || text === "＋＋") {
    const { joined, alreadyIn, newTeam } = joinQueue(
      comment.name,
      comment.userId || comment.id || comment.name,
      normalizePlatform(comment.service, comment.userId || "")
    );
    const targetService = normalizePlatform(comment.service, comment.userId || "") === "youtube" ? "yt"
      : normalizePlatform(comment.service, comment.userId || "") === "twitch" ? "twitch"
      : comment.service;
    if (alreadyIn) {
      try { await sendComment({ service: targetService, displayName: comment.name, comment: `${comment.name} 已在排隊或隊伍中！` }); } catch (_) {}
    } else if (joined && newTeam) {
      const memberNames = newTeam.members.map(m => m.name).join("、");
      try { await sendComment({ service: targetService, displayName: comment.name, comment: `🀄 第${newTeam.id}桌組成！${memberNames}` }); } catch (_) {}
    } else if (joined) {
      try { await sendComment({ service: targetService, displayName: comment.name, comment: `${comment.name} 加入排隊！` }); } catch (_) {}
    }
    return;
  }

  // 綁定指令：!綁定 CODE
  if (
    textLower.startsWith("綁定 ") ||
    textLower.startsWith("綁定\t") ||
    textLower.startsWith("驗證 ") ||
    textLower.startsWith("驗證\t")
  ) {
    await handleStreamBind(comment).catch((err) =>
      console.error("[Stream] 綁定/驗證處理失敗：", err.message)
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
