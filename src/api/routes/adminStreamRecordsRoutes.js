// 後台：直播記錄檢視（斗內事件流水 / 會員變動）
// 純讀取，讓管理員確認記錄有正確落地。
const { Router } = require("express");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const {
  listDonationEvents,
  getDonationSummary,
  listMembershipEvents,
  listMembershipStatuses
} = require("../../services/stream/streamRecordsService");

function createAdminStreamRecordsRoutes() {
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
      const [events, summary] = await Promise.all([
        listDonationEvents({ limit, boundOnly }),
        getDonationSummary()
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

  // 會員現況表（目前誰是會員 / 各等級）
  router.get("/admin/stream-records/membership-status", requireAdmin, async (req, res, next) => {
    try {
      const activeOnly = String(req.query.activeOnly || "") === "1";
      const limit = Number(req.query.limit) || 500;
      const statuses = await listMembershipStatuses({ activeOnly, limit });
      const activeCount = statuses.filter((s) => s.isMember).length;
      res.json(ok({ statuses, activeCount, total: statuses.length }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAdminStreamRecordsRoutes };
