"use strict";
const { Router } = require("express");
const { requireAuth } = require("./requireAuth");
const { ok } = require("../../shared/response");
const { getGameAssetManifest } = require("../../services/assets/gameAssetManifest");

function createPlayerAssetRoutes(serviceContext, { getManifest = getGameAssetManifest } = {}) {
  const router = Router();
  router.get("/api/me/assets/manifest", requireAuth, async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(ok(await getManifest(serviceContext)));
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createPlayerAssetRoutes };
