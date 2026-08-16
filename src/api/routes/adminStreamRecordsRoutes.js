// 後台：直播記錄檢視（斗內事件流水 / 會員變動）
// 純讀取，讓管理員確認記錄有正確落地。
const { Router } = require("express");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const {
  listDonationEvents,
  getDonationSummary,
  listMembershipEvents,
  listMemberDirectory
} = require("../../services/stream/streamRecordsService");
const { reconcileMembership } = require("../../services/stream/membershipTracker");
const globalBuff = require("../../services/stream/globalBuffService");
const scBar = require("../../services/stream/scBarService");
const { getConfig, saveConfig } = require("../../services/stream/streamEventConfig");
const { countActiveMembers } = require("../../services/stream/streamRecordsService");

function createAdminStreamRecordsRoutes(serviceContext, discordClient) {
  const router = Router();

  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (token !== config.api.adminPassword) {
      return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    }
    next();
  }

  // 斗內事件流水 + 彙總
  router.get("/admin/stream-records/donations", requireAdmin, async (req, res, next) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const boundOnly = String(req.query.boundOnly || "") === "1";
      const phase = String(req.query.phase || ""); // ""=全部 | "old"=8/9 20:00 前 | "new"=8/9 20:00 起
      const month = String(req.query.month || ""); // YYYY-MM；空白時以台北當月計算
      const [events, summary] = await Promise.all([
        listDonationEvents({ limit, boundOnly, phase }),
        getDonationSummary({ month })
      ]);
      res.json(ok({ events, summary }));
    } catch (err) {
      next(err);
    }
  });

  // 會員變動流水
  router.get("/admin/stream-records/memberships", requireAdmin, async (req, res, next) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const events = await listMembershipEvents({ limit });
      res.json(ok({ events }));
    } catch (err) {
      next(err);
    }
  });

  // 立即快照比對會員名單（不改動任何身分組；補齊現有會員 + 抓出被拔身分組的到期者）
  router.post("/admin/stream-records/reconcile", requireAdmin, async (_req, res, next) => {
    try {
      const config = require("../../config");
      if (!discordClient?.isReady?.()) {
        return res.status(503).json(fail("BOT_NOT_READY", "Discord Bot 尚未就緒，稍後再試。"));
      }
      if (!config.discord.guildId) {
        return res.status(400).json(fail("NO_GUILD", "尚未設定 DISCORD_GUILD_ID。"));
      }
      const guild = await discordClient.guilds.fetch(config.discord.guildId).catch(() => null);
      if (!guild) return res.status(400).json(fail("GUILD_NOT_FOUND", "找不到伺服器。"));
      const summary = await reconcileMembership(guild, serviceContext, { source: "manual-reconcile" });
      res.json(ok(summary, "reconcile done"));
    } catch (err) {
      next(err);
    }
  });

  // 會員現況表（目前誰是會員 / 各等級）
  router.get("/admin/stream-records/membership-status", requireAdmin, async (req, res, next) => {
    try {
      const activeOnly = String(req.query.activeOnly || "") === "1";
      const limit = Number(req.query.limit) || 1000;
      // 口徑＝遊戲內一致：Discord 身分組 ∪ 直播綁定，任一即會員
      const statuses = await listMemberDirectory({ activeOnly, limit });
      const activeCount = statuses.filter((s) => s.isMember).length;
      res.json(ok({ statuses, activeCount, total: statuses.length }));
    } catch (err) {
      next(err);
    }
  });

  // ── 全服活動：斗內觸發 Buff 設定 + 手動發 Buff ──

  router.get("/admin/stream-events/config", requireAdmin, async (_req, res, next) => {
    try {
      res.json(ok(await getConfig()));
    } catch (err) { next(err); }
  });

  router.post("/admin/stream-events/config", requireAdmin, async (req, res, next) => {
    try {
      const patch = {};
      for (const k of ["shortTermCapPct", "donationTiers", "scBar", "memberEvents", "viewerTiers"]) {
        if (req.body?.[k] !== undefined) patch[k] = req.body[k];
      }
      const next2 = await saveConfig(patch);
      res.json(ok(next2, "config saved"));
    } catch (err) { next(err); }
  });

  // 觀看人數：立即宣傳目前人數與加成狀態（重發廣播，不改動 buff）
  router.post("/admin/stream-events/viewer-announce", requireAdmin, async (_req, res, next) => {
    try {
      const r = await require("../../services/stream/viewerEventsService").announceCurrent();
      res.json(ok(r, "viewer announce sent"));
    } catch (err) { next(err); }
  });

  // 通行證：後台加點數（測試用）body { discordId, points, set? }
  router.post("/admin/pass/add-points", requireAdmin, async (req, res, next) => {
    try {
      const { discordId, points, set } = req.body || {};
      if (!discordId) return res.status(400).json(fail("INVALID_ARGUMENT", "discordId 必填"));
      const r = await serviceContext.passService.adminAddPoints(String(discordId), Number(points) || 0, { set: Boolean(set) });
      res.json(ok(r, "通行證點數已更新"));
    } catch (err) { if (err?.message) return res.status(400).json(fail("PASS_POINTS_FAILED", err.message)); next(err); }
  });

  // 只重置直播側的賽季資料；完整換季請使用玩家後台的「全體賽季重置」。
  // 實作仍共用完整換季會呼叫的同一個 helper，避免直播規則分岔。
  router.post("/admin/stream-events/reset-season", requireAdmin, async (_req, res, next) => {
    try {
      const { resetStreamSeasonState } = require("../../services/admin/seasonResetService");
      const r = await resetStreamSeasonState();
      res.json(ok(r, "season reset"));
    } catch (err) { next(err); }
  });

  // SC 累積條：目前進度（後台）
  router.get("/admin/stream-events/sc-bar", requireAdmin, async (_req, res, next) => {
    try {
      res.json(ok(await scBar.getPublicProgress()));
    } catch (err) { next(err); }
  });

  // SC 累積條：手動重置（清除方法之一；archive 到 scBarHistory）
  router.post("/admin/stream-events/sc-bar/reset", requireAdmin, async (req, res, next) => {
    try {
      const r = await scBar.reset({ archive: true, periodLabel: req.body?.periodLabel || null });
      res.json(ok(r, "sc bar reset"));
    } catch (err) { next(err); }
  });

  // 公開：SC 累積條進度（給玩家端進度條用，免登入）
  router.get("/api/stream/sc-bar", async (_req, res, next) => {
    try {
      const memberEvents = require("../../services/stream/memberEventsService");
      const gb = require("../../services/stream/globalBuffService");
      const [sc, memberCount, memberProgress] = await Promise.all([
        scBar.getPublicProgress(), countActiveMembers(), memberEvents.getPublicProgress(),
      ]);
      const mods = gb.getActiveModifiers();
      res.json(ok({
        ...sc,
        memberCount,
        memberProgress,                 // 會員里程碑進度
        activeBuff: {                   // 目前生效總加成（底盤 + 斗內/手動短期 + 觀看熱度，三桶相加）
          dropPct: mods.dropPct, goldPct: mods.goldPct, expPct: mods.expPct,
          permanent: mods.permanent, shortTerm: mods.shortTerm, viewer: mods.viewer,
        },
      }));
    } catch (err) { next(err); }
  });

  // 公開：即時觀看人數（OBS/後台/App 用）
  router.get("/api/stream/viewers", async (_req, res, next) => {
    try {
      res.json(ok(await require("../../services/stream/viewerService").getPublicState()));
    } catch (err) { next(err); }
  });

  // 公開：OBS overlay 用（會員數 + SC 累積 + 觀看人數，一次拿）
  router.get("/api/stream/overlay", async (_req, res, next) => {
    try {
      const viewerService = require("../../services/stream/viewerService");
      const [sc, memberCount, viewers] = await Promise.all([
        scBar.getPublicProgress(), countActiveMembers(), viewerService.getPublicState()
      ]);
      res.json(ok({ members: { count: memberCount }, sc, viewers }));
    } catch (err) { next(err); }
  });

  router.get("/admin/stream-events/buffs", requireAdmin, async (_req, res, next) => {
    try {
      const [active, recent] = [globalBuff.listActive(), await globalBuff.listRecent({ limit: 50 })];
      res.json(ok({ active, recent, modifiers: globalBuff.getActiveModifiers() }));
    } catch (err) { next(err); }
  });

  // 手動立即發一個全服 Buff（活動/測試用）
  router.post("/admin/stream-events/buff", requireAdmin, async (req, res, next) => {
    try {
      const b = req.body || {};
      const durationMinutes = Math.max(1, Number(b.durationMinutes) || 0);
      const r = await globalBuff.applyBuff({
        label: String(b.label || "管理員全服加成"),
        source: "manual",
        dropPct: Number(b.dropPct) || 0,
        goldPct: Number(b.goldPct) || 0,
        expPct: Number(b.expPct) || 0,
        durationMs: durationMinutes * 60_000,
        createdBy: "admin"
      });
      if (!r.applied) return res.status(400).json(fail("BUFF_NOT_APPLIED", `未套用：${r.reason || "未知"}`));
      // 廣播（可選）
      if (b.announce && typeof serviceContext._announceTownChat === "function") {
        const parts = [];
        if (r.buff.dropPct > 0) parts.push(`掉寶 +${r.buff.dropPct}%`);
        if (r.buff.goldPct > 0) parts.push(`金幣 +${r.buff.goldPct}%`);
        if (r.buff.expPct > 0) parts.push(`經驗 +${r.buff.expPct}%`);
        const hm = (d) => { try { return new Date(d).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
        try { serviceContext._announceTownChat(`🎉 全服活動！${parts.join("、")}，生效時間 ${hm(Date.now())}～${hm(r.buff?.endsAt || (Date.now() + durationMinutes * 60_000))}（${durationMinutes} 分鐘）！`); } catch (_) {}
      }
      res.json(ok(r.buff, "buff applied"));
    } catch (err) { next(err); }
  });

  // 結束 buff：帶 id 結束單一，否則全清
  router.post("/admin/stream-events/buff/clear", requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.body?.id || "").trim();
      const r = id ? await globalBuff.clearBuff(id) : await globalBuff.clearAll();
      res.json(ok(r, "cleared"));
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAdminStreamRecordsRoutes };
