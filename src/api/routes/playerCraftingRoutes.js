"use strict";

const { Router } = require("express");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");

function requireCraftingTester(req, res, next) {
  if (!req.playerRecord?.discordId) {
    return res.status(401).json(fail("UNAUTHORIZED", "請先登入。"));
  }
  next();
}

function createPlayerCraftingRoutes(serviceContext) {
  const router = Router();

  router.get("/api/me/crafting", requireAuth, requireCraftingTester, async (req, res, next) => {
    try {
      const data = await serviceContext.craftingService.getPlayerState(req.playerRecord.discordId);
      return res.json(ok(data));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/me/crafting/:recipeId", requireAuth, requireCraftingTester, async (req, res, next) => {
    try {
      const requestId = req.body?.requestId;
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "合成請求識別碼無效，請重新確認。"));
      }
      const data = await serviceContext.craftingService.craft(
        req.playerRecord.discordId,
        req.params.recipeId,
        req.body?.quantity,
        requestId
      );
      const outputText = data.outputs.map((line) => `${line.name} ×${line.quantity}`).join("、");
      return res.json(ok(data, `合成成功：${outputText}`));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createPlayerCraftingRoutes,
  requireCraftingTester
};
