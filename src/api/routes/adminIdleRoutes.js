"use strict";

const { Router } = require("express");
const { ok, fail } = require("../../shared/response");

function createAdminIdleRoutes(serviceContext) {
  const router = Router();
  const idleService = serviceContext.idleService;

  router.use("/admin/idle-zones", (req, res, next) => {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    const config = require("../../config");
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();
  });

  router.get("/admin/idle-zones", async (req, res, next) => {
    try {
      const includeDisabled = String(req.query.includeDisabled || "true") !== "false";
      const zones = await idleService.listZones({ includeDisabled });
      res.json(ok(zones, "idle zones fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/idle-zones", async (req, res, next) => {
    try {
      const zone = await idleService.createZone(req.body || {});
      res.json(ok(zone, "idle zone created"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/idle-zones/:id", async (req, res, next) => {
    try {
      const zone = await idleService.updateZone(req.params.id, req.body || {});
      res.json(ok(zone, "idle zone updated"));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/idle-zones/:id", async (req, res, next) => {
    try {
      await idleService.deleteZone(req.params.id);
      res.json(ok(null, "idle zone deleted"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/idle-zones/seed", async (_req, res, next) => {
    try {
      const result = await idleService.ensureDefaultZones();
      res.json(ok(result, "idle zones seeded"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminIdleRoutes
};

