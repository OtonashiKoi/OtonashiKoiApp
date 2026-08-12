"use strict";

const { Router } = require("express");
const { ok, fail } = require("../../shared/response");
const { isCraftingTester } = require("../../shared/craftingAccess");
const { requireAuth } = require("./requireAuth");

function requireCraftingTester(req, res, next) {
  if (!isCraftingTester(req.playerRecord?.discordId)) {
    return res.status(403).json(fail("CRAFTING_TEST_ONLY", "合成系統目前只開放音無恋測試。"));
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
      const data = await serviceContext.craftingService.craft(
        req.playerRecord.discordId,
        req.params.recipeId,
        req.body?.quantity
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
