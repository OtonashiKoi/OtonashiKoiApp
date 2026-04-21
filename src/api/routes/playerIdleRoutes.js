"use strict";

const { Router } = require("express");
const jwt = require("jsonwebtoken");
const { ok, fail } = require("../../shared/response");

function createPlayerIdleRoutes(serviceContext) {
  const router = Router();
  const idleService = serviceContext.idleService;

  router.use("/api/idle", (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      res.status(401).json(fail("UNAUTHORIZED", "Missing token"));
      return;
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
      req.playerRecord = decoded;
      next();
    } catch (_) {
      res.status(401).json(fail("UNAUTHORIZED", "Invalid or expired token"));
    }
  });

  router.get("/api/idle/status", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const status = await idleService.getPlayerStatus(discordId, displayName);
      res.json(ok(status, "idle status fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/idle/zones", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const status = await idleService.getPlayerStatus(discordId, displayName);
      res.json(ok(status.zones || [], "idle zones fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/idle/start", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const zoneId = String(req.body?.zoneId || "").trim();
      if (!zoneId) {
        res.status(400).json(fail("INVALID_ARGUMENT", "zoneId is required"));
        return;
      }
      const started = await idleService.startSession(discordId, displayName, zoneId);
      res.json(ok(started, "idle session started"));
    } catch (error) {
      if (error.status) {
        res.status(error.status).json(fail(error.code || "IDLE_START_FAILED", error.message));
        return;
      }
      next(error);
    }
  });

  router.post("/api/idle/claim", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const force = Boolean(req.body?.force);
      const summary = await idleService.claimSession(discordId, displayName, { force });
      res.json(ok(summary, "idle reward claimed"));
    } catch (error) {
      if (error.status) {
        res.status(error.status).json(fail(error.code || "IDLE_CLAIM_FAILED", error.message));
        return;
      }
      next(error);
    }
  });

  router.post("/api/idle/cancel", async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const result = await idleService.cancelSession(discordId);
      res.json(ok(result, "idle session canceled"));
    } catch (error) {
      if (error.status) {
        res.status(error.status).json(fail(error.code || "IDLE_CANCEL_FAILED", error.message));
        return;
      }
      next(error);
    }
  });

  return router;
}

module.exports = {
  createPlayerIdleRoutes
};

