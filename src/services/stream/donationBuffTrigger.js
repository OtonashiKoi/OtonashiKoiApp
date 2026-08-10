// 斗內全服加成（累積 session 模型）
// ------------------------------------------------
// 規則（玩家定案）：
//   ① 爬升期：累積金額每 100 元 → +5%，最高 NT$600 = 30%。每筆斗內把時效「重置回 60 分」。
//   ② 封頂後（已達 30%）：% 固定 30%，追加金額換時間（NT$100 = +60 分），疊在剩餘時間上。
//   ③ 啟動門檻：沒有生效中 session 時，第一筆需 ≥ NT$100 才會啟動。
//   ④ 時效歸零 → 本輪結束、累積歸零，下輪要再從 NT$100 起算。
// 各類型（掉寶/金幣/經驗）同一個 %。以單一「donation-session」buff 覆寫式儲存。
const { getDonationSession, setDonationSessionBuff, refresh: refreshBuffCache } = require("./globalBuffService");
const { getConfig, DONATION_SESSION_MAX_PCT } = require("./streamEventConfig");

// 累積模型常數
const STEP_TWD = 100;          // 每 100 元
const STEP_PCT = 5;            // +5%
const MAX_PCT = DONATION_SESSION_MAX_PCT; // 封頂 30%，與模擬器共用單一來源
const CAP_TWD = 600;           // 達 600 = 30% 封頂
const BASE_MINUTES = 60;       // 爬升期 / 剛封頂的基礎時效
const EXTEND_MIN_PER_100 = 60; // 封頂後每 100 元 +60 分
const MIN_ACTIVATE_TWD = 100;  // 啟動門檻（第一筆）

function pctForCum(cum) {
  return Math.min(MAX_PCT, Math.floor(cum / STEP_TWD) * STEP_PCT);
}

/**
 * @param {{ twdAmount:number, sourceRef:string }} donation
 * @param {{ discordId:string, displayName:string }} meta
 * @param {object} serviceContext 需含 _announceTownChat（全服廣播）
 */
async function maybeTriggerDonationBuff(donation, meta, serviceContext) {
  try {
    const cfg = (await getConfig()).donationTiers;
    if (!cfg.enabled) return { triggered: false, reason: "disabled" };
    const twd = Math.max(0, Math.round(Number(donation?.twdAmount) || 0));
    if (twd <= 0) return { triggered: false, reason: "no-amount" };

    // ⚠️ 判定前必先從 DB 重載快取：補發腳本等「非伺服器程序」的快取是空的，
    // 直接讀會誤判「無進行中 session」→ 開新 session 把舊的大 buff 整筆蓋掉
    // （2026-07-25 事故：4665 分鐘 buff 被補發腳本砍成 68 分鐘）
    await refreshBuffCache().catch(() => {});
    const nowMs = Date.now();
    const session = getDonationSession();
    const active = !!session;

    // 冪等：同一筆斗內事件不重複累積
    const ref = String(donation?.sourceRef || "");
    const prevRefs = (active && Array.isArray(session.processedRefs)) ? session.processedRefs : [];
    if (ref && prevRefs.includes(ref)) return { triggered: false, reason: "duplicate" };

    const prevCum = active ? (Number(session.cumTwd) || 0) : 0;
    const prevEndsMs = active ? Date.parse(session.endsAt) : nowMs;

    // 啟動門檻：沒有生效中 session 時，第一筆需 ≥ MIN_ACTIVATE_TWD
    if (!active && twd < MIN_ACTIVATE_TWD) return { triggered: false, reason: "below-activate" };

    const newCum = prevCum + twd;
    const newPct = pctForCum(newCum);

    let endsAtMs;
    if (newCum < CAP_TWD) {
      // 爬升期：時效重置回 60 分
      endsAtMs = nowMs + BASE_MINUTES * 60_000;
    } else if (prevCum >= CAP_TWD) {
      // 已封頂 → 依追加金額加時間（100=60分），疊在剩餘時間上
      endsAtMs = Math.max(prevEndsMs, nowMs) + Math.round((twd / STEP_TWD) * EXTEND_MIN_PER_100) * 60_000;
    } else {
      // 本筆剛跨過 600：基礎 60 分 + 超過 600 的部分換時間
      const excess = newCum - CAP_TWD;
      endsAtMs = nowMs + BASE_MINUTES * 60_000 + Math.round((excess / STEP_TWD) * EXTEND_MIN_PER_100) * 60_000;
    }

    const name = meta?.displayName || "神秘玩家";
    const r = await setDonationSessionBuff({
      pct: newPct,
      endsAtMs,
      cumTwd: newCum,
      label: `斗內全服加成（累積 NT$${newCum}）`,
      processedRefs: ref ? [...prevRefs, ref] : prevRefs,
    });
    if (!r.applied) return { triggered: false, reason: r.reason };

    // 全服廣播
    if (cfg.announce && typeof serviceContext?._announceTownChat === "function") {
      const remainMin = Math.max(1, Math.round((endsAtMs - nowMs) / 60_000));
      const capped = newPct >= MAX_PCT;
      const msg = capped
        ? `🔥 感謝 ${name} 斗內 NT$${twd}！全服加成已達頂「掉寶／金幣／經驗 各 +${MAX_PCT}%」，時效延長至剩 ${remainMin} 分鐘！`
        : `🎉 感謝 ${name} 斗內 NT$${twd}！全服加成「各 +${newPct}%」（累積 NT$${newCum}／NT$${CAP_TWD} 封頂），剩 ${remainMin} 分鐘！`;
      try { serviceContext._announceTownChat(msg); } catch (_) { /* 廣播失敗不影響 buff */ }
    }
    return { triggered: true, buff: r.buff, pct: newPct, cumTwd: newCum };
  } catch (err) {
    console.warn("[GlobalBuff] 斗內觸發失敗：", err?.message || err);
    return { triggered: false, reason: "error" };
  }
}

module.exports = { maybeTriggerDonationBuff };
