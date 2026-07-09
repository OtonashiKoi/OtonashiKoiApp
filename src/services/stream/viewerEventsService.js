// 觀看人數即時觸發（第四線 buff）
// ------------------------------------------------
// 規則：同時觀看總人數跨門檻 → 發全服 buff。
//   ・單一 buff、覆寫升級：達更高階會把低階換成高階，不疊加。
//   ・不降階：已在高階時，人數暫時掉到低階門檻不會被降級。
//   ・持續化：直播中每輪把到期時間續到「現在 + graceMinutes(預設60分)」，所以直播中永不過期。
//     直播一結束(無 live 枠)就不再續 → buff 會在「最後一次 live 輪詢 + graceMinutes」自然消失。
//   ・觸發/升級時全服廣播(附直播連結 + 宣傳下一階目標)；純延命不重發。
const { getConfig } = require("./streamEventConfig");
const globalBuff = require("./globalBuffService");
const viewerService = require("./viewerService");
const announceTownChat = require("../../shared/announceTownChat");

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

let _evaluating = false; // 並發鎖：避免重疊執行造成重複套用/廣播

/**
 * 每 20 秒呼叫一次：維持/升級觀看熱度 buff（持續化 + 直播結束 60 分寬限）。
 */
async function evaluate() {
  if (_evaluating) return { triggered: false, reason: "busy" };
  _evaluating = true;
  try {
    const cfg = (await getConfig()).viewerTiers;
    if (!cfg || !cfg.enabled) return { triggered: false, reason: "disabled" };
    const graceMs = Math.max(1, Number(cfg.graceMinutes) || 60) * 60_000;

    const state = await viewerService.getPublicState();
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

    // 延命節流：同階且剩餘時間仍充足 → 不重寫 DB（避免每 20 秒寫入）
    if (session && !isUpgrade) {
      const remain = Date.parse(session.endsAt) - Date.now();
      if (remain > graceMs - 120_000) return { triggered: false, reason: "kept" };
    }

    const r = await globalBuff.setViewerSessionBuff({
      dropPct: tierObj.dropPct, goldPct: tierObj.goldPct, expPct: tierObj.expPct,
      endsAtMs: Date.now() + graceMs,
      tierMin: targetTier,
      label: `${tierObj.label || "觀看熱度"}（觀看 ${cur} 人）`,
    });
    if (!r.applied) return { triggered: false, reason: r.reason };

    if (cfg.announce && (isNew || isUpgrade)) {
      try { announceTownChat.announceTownChat(buildMessage(cur, tierObj, tiers, isUpgrade ? "upgrade" : "new", cfg)); } catch (_) {}
    }
    return { triggered: isNew || isUpgrade, kept: !(isNew || isUpgrade), tierMin: targetTier };
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

module.exports = { evaluate, announceCurrent };
