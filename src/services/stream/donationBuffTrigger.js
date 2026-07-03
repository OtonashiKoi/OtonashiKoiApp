// 斗內觸發全服 Buff（模組 A）
// 依後台設定(streamEventConfig.donationBuff)判斷：單筆斗內達門檻 → 套用全服 buff + 廣播。
// best-effort，任何失敗都不影響斗內發鑽主流程。
const { applyBuff } = require("./globalBuffService");
const { getConfig } = require("./streamEventConfig");

/**
 * @param {{ twdAmount:number, sourceRef:string }} donation
 * @param {{ discordId:string, displayName:string }} meta
 * @param {object} serviceContext 需含 _announceTownChat（全服廣播）
 */
async function maybeTriggerDonationBuff(donation, meta, serviceContext) {
  try {
    const cfg = (await getConfig()).donationBuff;
    if (!cfg.enabled) return { triggered: false, reason: "disabled" };
    const twd = Number(donation?.twdAmount) || 0;
    if (twd < Number(cfg.minTwd || 0)) return { triggered: false, reason: "below-threshold" };

    const durationMs = Number(cfg.durationMinutes || 0) * 60_000;
    const name = meta?.displayName || "神秘玩家";
    const r = await applyBuff({
      label: `${name} 的斗內加成`,
      source: "donation",
      sourceRef: `donbuff:${donation.sourceRef}`, // 冪等：同斗內事件不重複套 buff
      dropPct: cfg.dropPct, goldPct: cfg.goldPct, expPct: cfg.expPct,
      durationMs,
      createdBy: "stream:donation"
    });
    if (!r.applied) return { triggered: false, reason: r.reason };

    if (cfg.announce && typeof serviceContext?._announceTownChat === "function") {
      const parts = [];
      if (cfg.dropPct > 0) parts.push(`掉寶 +${cfg.dropPct}%`);
      if (cfg.goldPct > 0) parts.push(`金幣 +${cfg.goldPct}%`);
      if (cfg.expPct > 0) parts.push(`經驗 +${cfg.expPct}%`);
      const eff = parts.join("、") || "全服加成";
      try {
        serviceContext._announceTownChat(`🎉 感謝 ${name} 斗內 NT$${twd}！全服 ${eff}，持續 ${cfg.durationMinutes} 分鐘！`);
      } catch (_) { /* 廣播失敗不影響 buff */ }
    }
    return { triggered: true, buff: r.buff };
  } catch (err) {
    console.warn("[GlobalBuff] 斗內觸發失敗：", err?.message || err);
    return { triggered: false, reason: "error" };
  }
}

module.exports = { maybeTriggerDonationBuff };
