// 觀看人數即時觸發（第四線 buff）
// ------------------------------------------------
// 規則：同時觀看總人數跨門檻 → 發全服 buff。
//   ・單一 buff、覆寫升級：達更高階會把低階換成高階，不疊加。
//   ・不降階：已在高階時，人數暫時掉到低階門檻不會被降級。
//   ・持續化：直播中每輪把到期時間續到「現在 + graceMinutes(預設60分)」，所以直播中永不過期。
//     直播一結束(無 live 枠)就不再續 → buff 會在「最後一次 live 輪詢 + graceMinutes」自然消失。
//   ・同場同階只廣播一次；升階可補發，但任意兩次提示仍受最短間隔限制。
const { getConfig } = require("./streamEventConfig");
const globalBuff = require("./globalBuffService");
const viewerService = require("./viewerService");
const youtubeUpcoming = require("./youtubeUpcomingService");
const announceTownChat = require("../../shared/announceTownChat");

const GO_LIVE_CHANNEL_ID = String(
  process.env.STREAM_GO_LIVE_CHANNEL_ID || "1292448104905441331"
).trim();

function pctParts(t) {
  const p = [];
  if (Number(t?.dropPct) > 0) p.push(`掉寶 +${t.dropPct}%`);
  if (Number(t?.goldPct) > 0) p.push(`金幣 +${t.goldPct}%`);
  if (Number(t?.expPct) > 0) p.push(`經驗 +${t.expPct}%`);
  return p.join("／");
}

// 組觸發/升級/宣傳用的廣播文字（含下一階目標 + 直播連結）
function buildMessage(cur, tierObj, tiers, mode, cfg) {
  // mode: "new" | "upgrade" | "promo"
  const eff = pctParts(tierObj);
  let head;
  if (mode === "upgrade") head = `🔥 直播觀看人數衝上 **${cur}** 人！全服加成升級`;
  else if (mode === "promo") head = `📣 目前直播觀看 **${cur}** 人！全服加成進行中`;
  else head = `📺 直播觀看人數突破 **${cur}** 人！開啟全服加成`;
  let msg = `${head}「${eff}」，直播中持續有效、直播結束後再維持 ${Math.max(1, Number(cfg.graceMinutes) || 60)} 分鐘！`;

  const idx = tiers.findIndex((t) => Number(t.minViewers) === Number(tierObj.minViewers));
  const nextTier = idx >= 0 ? tiers[idx + 1] : null;
  if (nextTier) {
    const need = Math.max(1, Number(nextTier.minViewers) - cur);
    msg += `\n🎯 下一目標：衝到 **${nextTier.minViewers}** 人（再 ${need} 人）解鎖【${nextTier.label || "更高加成"}】${pctParts(nextTier)}！`;
  } else {
    msg += `\n🏆 已達最高階，感謝大家撐場！`;
  }
  const url = String(cfg.streamUrl || "").trim();
  if (url) msg += `\n👉 一起來看直播衝更高：${url}`;
  return msg;
}

function selectLiveBroadcast(state, cfg) {
  const active = (Array.isArray(state?.services) ? state.services : [])
    .filter((s) => s?.isLive && !s?.stale && !s?.board && !s?.upcoming)
    .sort((a, b) => {
      // 同時多開時優先 YouTube，其次依穩定 id 排序，避免輪詢順序改變造成重複公告。
      const platformRank = (s) => s?.platform === "youtube" ? 0 : s?.platform === "twitch" ? 1 : 2;
      return platformRank(a) - platformRank(b)
        || String(a?.id || a?.service || "").localeCompare(String(b?.id || b?.service || ""));
    });
  const primary = active[0];
  if (!primary) return null;

  const url = String(primary.url || cfg?.streamUrl || "").trim();
  const title = String(primary.title || "").trim();
  const platform = String(primary.platform || primary.service || "").trim();
  // 場次識別只用「平台+網址」：標題不納入，否則主播直播中途改標題會被當成新的一場、重發公告。
  // Twitch URL 固定不變 → 由 viewerService 的時間冷卻負責區分「下一場」，不需要靠標題。
  const fingerprint = [platform, url].join("|").slice(0, 700);
  return { url, title, platform, fingerprint };
}

// 去抖：OneComme 的 isLive 會忽真忽假（預約枠、連線抖動），單一輪輪詢不足以判定開台或關台。
// 2026-08-02 事故：一輪 live → 公告，下一輪 offline → 釋放鎖，再下一輪 live → 又公告，20 秒一則。
const LIVE_CONFIRM_ROUNDS = 3;    // 連續 3 輪（約 60 秒）都是同一場直播才公告
const OFFLINE_CONFIRM_ROUNDS = 6; // 連續 6 輪（約 120 秒）都沒直播才視為關台、釋放公告鎖
let _liveStreak = 0;
let _offlineStreak = 0;
let _streakFingerprint = "";

function buildGoLiveMessage(url) {
  return `📺 **開始直播摟～**\n${url}`;
}

async function evaluateGoLiveAnnouncement(state, cfg) {
  const live = state?.live === true;
  const broadcast = live ? selectLiveBroadcast(state, cfg) : null;

  if (!broadcast?.url || !broadcast.fingerprint) {
    _liveStreak = 0;
    _streakFingerprint = "";
    _offlineStreak += 1;
    // 連續多輪都沒直播才真的當關台；只抖一下不釋放鎖，避免「釋放→重新搶佔→重發公告」的迴圈
    if (_offlineStreak >= OFFLINE_CONFIRM_ROUNDS) await viewerService.markLiveOffline();
    return { sent: false, reason: live ? "missing-live-url" : "offline" };
  }

  _offlineStreak = 0;
  if (_streakFingerprint !== broadcast.fingerprint) {
    _streakFingerprint = broadcast.fingerprint;
    _liveStreak = 0;
  }
  _liveStreak += 1;
  if (_liveStreak < LIVE_CONFIRM_ROUNDS) {
    console.log(`[viewerEvents] 開台偵測確認中 ${_liveStreak}/${LIVE_CONFIRM_ROUNDS} url=${broadcast.url}`);
    return { sent: false, reason: "confirming" };
  }

  const claimed = await viewerService.claimGoLiveAnnouncement({
    ...broadcast,
    channelId: GO_LIVE_CHANNEL_ID,
  });
  if (!claimed) return { sent: false, reason: "already-announced" };

  try {
    const { getBotClient } = require("../../bot/runtimeContext");
    const client = getBotClient();
    if (!client?.isReady?.()) throw new Error("Discord bot 尚未就緒");
    const channel = await client.channels.fetch(GO_LIVE_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
      throw new Error(`頻道 ${GO_LIVE_CHANNEL_ID} 不是可發送的文字頻道`);
    }
    await channel.send({
      content: buildGoLiveMessage(broadcast.url),
      allowedMentions: { parse: [] },
    });
    await viewerService.completeGoLiveAnnouncement(broadcast.fingerprint, true);
    console.log(`[viewerEvents] 已發送開台公告 channel=${GO_LIVE_CHANNEL_ID} url=${broadcast.url}`);
    return { sent: true, channelId: GO_LIVE_CHANNEL_ID, url: broadcast.url };
  } catch (err) {
    await viewerService.completeGoLiveAnnouncement(
      broadcast.fingerprint,
      false,
      err?.message || String(err)
    );
    console.warn("[viewerEvents] 開台公告發送失敗：", err?.message || err);
    return { sent: false, reason: "send-failed" };
  }
}

async function maybeAnnounceViewerTier({ state, cfg, cur, tierObj, tiers, targetTier }) {
  if (!cfg?.announce) return { sent: false, reason: "disabled" };
  if (cur < targetTier) return { sent: false, reason: "tier-no-longer-reached" };
  const broadcast = selectLiveBroadcast(state, cfg);
  if (!broadcast?.fingerprint) return { sent: false, reason: "missing-live-fingerprint" };
  const claim = await viewerService.claimViewerTierAnnouncement({
    fingerprint: broadcast.fingerprint,
    tierMin: targetTier,
    cooldownMinutes: cfg.announceCooldownMinutes,
  });
  if (!claim.claimed) return { sent: false, reason: "cooldown-or-duplicate" };
  const sameStream = claim.previousFingerprint === broadcast.fingerprint;
  const mode = sameStream && claim.previousTier > 0 ? "upgrade" : "new";
  await announceTownChat.announceTownChat(buildMessage(cur, tierObj, tiers, mode, cfg));
  return { sent: true, mode };
}

let _evaluating = false; // 並發鎖：避免重疊執行造成重複套用/廣播

/**
 * 每 20 秒呼叫一次：維持/升級觀看熱度 buff（持續化 + 直播結束 60 分寬限）。
 */
async function evaluate() {
  if (_evaluating) return { triggered: false, reason: "busy" };
  _evaluating = true;
  try {
    const cfg = (await getConfig()).viewerTiers;
    const state = await viewerService.getPublicState();
    // OneComme 若比官方 API 更早看見待機室，也走同一個 broadcastId 去重後立即預告。
    await youtubeUpcoming.announceFromViewerState(state);
    // 開台公告與 30 人 Buff 門檻分離：只要偵測到真的開台就發，不必等到 30 人。
    await evaluateGoLiveAnnouncement(state, cfg);

    if (!cfg || !cfg.enabled) return { triggered: false, reason: "disabled" };
    const graceMs = Math.max(1, Number(cfg.graceMinutes) || 60) * 60_000;
    const cur = Math.max(0, Math.round(Number(state.current) || 0));
    const live = state.live === true || cur > 0;
    const session = globalBuff.getViewerSession();

    // 直播結束：不再續命，讓 buff 自然在「最後一次 live 輪詢 + grace」過期
    if (!live) return { triggered: false, reason: "offline" };

    const tiers = (cfg.tiers || []).slice().sort((a, b) => a.minViewers - b.minViewers);
    let matched = null;
    for (const t of tiers) { if (cur >= Number(t.minViewers)) matched = t; }
    const newTier = matched ? Number(matched.minViewers) : 0;
    const activeTier = session ? (Number(session.tierMin) || 0) : 0;
    const targetTier = Math.max(newTier, activeTier); // 不降階
    if (targetTier <= 0) return { triggered: false, reason: "below-threshold" };

    const tierObj = tiers.find((t) => Number(t.minViewers) === targetTier) || matched;
    const isNew = !session;
    const isUpgrade = !!session && newTier > activeTier;

    // 延命節流：同階且剩餘時間仍充足 → 不重寫 DB；但仍評估公告冷卻，才能在時間到後補發最高階。
    let kept = false;
    if (session && !isUpgrade) {
      const remain = Date.parse(session.endsAt) - Date.now();
      kept = remain > graceMs - 120_000;
    }

    if (!kept) {
      const r = await globalBuff.setViewerSessionBuff({
        dropPct: tierObj.dropPct, goldPct: tierObj.goldPct, expPct: tierObj.expPct,
        endsAtMs: Date.now() + graceMs,
        tierMin: targetTier,
        label: `${tierObj.label || "觀看熱度"}（觀看 ${cur} 人）`,
      });
      if (!r.applied) return { triggered: false, reason: r.reason };
    }
    const announcement = await maybeAnnounceViewerTier({ state, cfg, cur, tierObj, tiers, targetTier });
    return { triggered: isNew || isUpgrade, kept, announced: announcement.sent, tierMin: targetTier };
  } catch (err) {
    console.warn("[viewerEvents] evaluate 失敗：", err?.message || err);
    return { triggered: false, reason: "error" };
  } finally {
    _evaluating = false;
  }
}

/**
 * 手動立即宣傳目前觀看人數與加成狀態（後台「📣 立即宣傳」用；不改動 buff）。
 */
async function announceCurrent() {
  try {
    const cfg = (await getConfig()).viewerTiers;
    const state = await viewerService.getPublicState();
    const cur = Math.max(0, Math.round(Number(state.current) || 0));
    const tiers = (cfg.tiers || []).slice().sort((a, b) => a.minViewers - b.minViewers);
    const session = globalBuff.getViewerSession();
    const activeTier = session ? (Number(session.tierMin) || 0) : 0;
    let matched = null;
    for (const t of tiers) { if (cur >= Number(t.minViewers)) matched = t; }
    const effTier = Math.max(activeTier, matched ? Number(matched.minViewers) : 0);
    const tierObj = tiers.find((t) => Number(t.minViewers) === effTier);

    let msg;
    if (tierObj) {
      msg = buildMessage(cur, tierObj, tiers, "promo", cfg);
    } else {
      const first = tiers[0];
      msg = `📣 目前直播觀看 **${cur}** 人！`;
      if (first) msg += `\n🎯 衝到 **${first.minViewers}** 人（再 ${Math.max(1, first.minViewers - cur)} 人）解鎖全服加成【${first.label}】${pctParts(first)}！`;
      const url = String(cfg.streamUrl || "").trim();
      if (url) msg += `\n👉 一起來看直播：${url}`;
    }
    await announceTownChat.announceTownChat(msg);
    return { sent: true, current: cur, tierMin: effTier };
  } catch (err) {
    console.warn("[viewerEvents] announceCurrent 失敗：", err?.message || err);
    return { sent: false, reason: "error" };
  }
}

module.exports = {
  evaluate,
  announceCurrent,
  selectLiveBroadcast,
  buildGoLiveMessage,
  evaluateGoLiveAnnouncement,
  maybeAnnounceViewerTier,
};
