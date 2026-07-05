// 後台：附魔設定（附魔池數值範圍 / 每階條數 / 可骰 band）
const { Router } = require("express");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const { getConfig, saveConfig } = require("../../services/enchant/enchantConfig");
const enchantService = require("../../services/enchant/enchantService");

function createAdminEnchantRoutes() {
  const router = Router();

  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (token !== config.api.adminPassword) {
      return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    }
    next();
  }

  router.get("/admin/enchant/config", requireAdmin, async (_req, res, next) => {
    try {
      res.json(ok(await getConfig()));
    } catch (err) { next(err); }
  });

  router.post("/admin/enchant/config", requireAdmin, async (req, res, next) => {
    try {
      const patch = {};
      if (req.body?.bands !== undefined) patch.bands = req.body.bands;
      if (req.body?.lineCountByTier !== undefined) patch.lineCountByTier = req.body.lineCountByTier;
      if (req.body?.rollableBandsByTier !== undefined) patch.rollableBandsByTier = req.body.rollableBandsByTier;
      const next2 = await saveConfig(patch);
      await enchantService.refresh(); // 即時生效，免 restart
      res.json(ok(next2, "已儲存並套用"));
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAdminEnchantRoutes };
