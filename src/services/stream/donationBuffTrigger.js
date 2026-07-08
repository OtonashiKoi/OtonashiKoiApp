// 斗內即時分級 buff（短期）
// 依後台設定(streamEventConfig.donationTiers)：單筆斗內金額 → 挑「minTwd 不超過金額」的最高一級 → 套用短期全服 buff。
// 模式 A：每筆都套（獨立疊加），效果在 getActiveModifiers 相加、每類型封頂 shortTermCapPct。
// best-effort，任何失敗都不影響斗內發鑽主流程。
const { applyBuff } = require("./globalBuffService");
const { getConfig } = require("./streamEventConfig");

// 台灣時間 HH:MM
function fmtHM(dateOrIso) {
  try {
    return new Date(dateOrIso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" });
  } catch (_) { return ""; }
}

function pickTier(tiers, twd) {
  let picked = null;
  for (const t of tiers) {
    if (twd >= t.minTwd && (!picked || t.minTwd > picked.minTwd)) picked = t;
  }
  return picked;
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
    const twd = Number(donation?.twdAmount) || 0;
    const tier = pickTier(cfg.tiers || [], twd);
    if (!tier) return { triggered: false, reason: "below-min-tier" };

    const name = meta?.displayName || "神秘玩家";
    const r = await applyBuff({
      label: `${name} 的斗內加成（${tier.label}）`,
      source: "donation",
      sourceRef: `donbuff:${donation.sourceRef}`, // 冪等：同斗內事件不重複套
      dropPct: tier.dropPct, goldPct: tier.goldPct, expPct: tier.expPct,
      durationMs: Number(tier.durationMinutes) * 60_000,
      createdBy: "stream:donation",
    });
    if (!r.applied) return { triggered: false, reason: r.reason };

    if (cfg.announce && typeof serviceContext?._announceTownChat === "function") {
      const parts = [];
      if (tier.dropPct > 0) parts.push(`掉寶 +${tier.dropPct}%`);
      if (tier.goldPct > 0) parts.push(`金幣 +${tier.goldPct}%`);
      if (tier.expPct > 0) parts.push(`經驗 +${tier.expPct}%`);
      const eff = parts.join("、") || "全服加成";
      const startHM = fmtHM(Date.now());
      const endHM = fmtHM(r.buff?.endsAt || (Date.now() + Number(tier.durationMinutes) * 60_000));
      try {
        serviceContext._announceTownChat(`🎉 感謝 ${name} 斗內 NT$${twd}！全服 ${eff}，生效時間 ${startHM}～${endHM}（${tier.durationMinutes} 分鐘）！`);
      } catch (_) { /* 廣播失敗不影響 buff */ }
    }
    return { triggered: true, buff: r.buff, tier: tier.label };
  } catch (err) {
    console.warn("[GlobalBuff] 斗內觸發失敗：", err?.message || err);
    return { triggered: false, reason: "error" };
  }
}

module.exports = { maybeTriggerDonationBuff };
