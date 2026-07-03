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
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.playerRecord = decoded;
      next();
    } catch (_) {
      res.status(401).json(fail("UNAUTHORIZED", "Invalid or expired token"));
    }
  });

  // 與 DC 掛機同一套模型（getDiscordPanelStatus / *DiscordSession）：
  //   收益＝該區非 BOSS 平均×10%、前 5 分鐘無獎勵、單次最多 12 小時、
  //   非會員每日 6 小時(台北時區)、只給金幣與 EXP 不掉道具。
  // 會員判定：未帶 memberRoleIds 時 _resolveMembership 會退回 progress.playerTier。
  const errStatus = (error) => error.status || error.statusCode || null;

  router.get("/api/idle/status", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const status = await idleService.getDiscordPanelStatus(discordId, displayName);
      res.json(ok(status, "idle status fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/idle/zones", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const status = await idleService.getDiscordPanelStatus(discordId, displayName);
      res.json(ok(status.zones || [], "idle zones fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/idle/start", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      // 前端傳 zoneKey（相容舊欄位 zoneId）
      const zoneKey = String(req.body?.zoneKey || req.body?.zoneId || "").trim();
      if (!zoneKey) {
        res.status(400).json(fail("INVALID_ARGUMENT", "zoneKey is required"));
        return;
      }
      // 主線閘門：未看完該區主線 → 不能在該區掛機（與戰鬥同規則）
      try {
        const storyGate = await serviceContext.storyService.checkZoneStoryGate(discordId, zoneKey);
        if (storyGate) {
          res.status(403).json({
            status: "error", code: "story_required",
            message: `需先閱讀主線「${storyGate.chapterTitle}」才能在此區域掛機。`,
            chapterId: storyGate.chapterId, chapterTitle: storyGate.chapterTitle
          });
          return;
        }
      } catch (e) {
        console.warn("[Story] idle zone gate check failed:", e?.message || e);
      }
      const started = await idleService.startDiscordSession(discordId, displayName, zoneKey);
      res.json(ok(started, "idle session started"));
    } catch (error) {
      const st = errStatus(error);
      if (st) {
        res.status(st).json(fail(error.code || "IDLE_START_FAILED", error.message));
        return;
      }
      next(error);
    }
  });

  router.post("/api/idle/claim", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const force = Boolean(req.body?.force);
      const summary = await idleService.claimDiscordSession(discordId, displayName, "manual_claim", { force });
      res.json(ok(summary, "idle reward claimed"));
    } catch (error) {
      const st = errStatus(error);
      if (st) {
        res.status(st).json(fail(error.code || "IDLE_CLAIM_FAILED", error.message));
        return;
      }
      next(error);
    }
  });

  router.post("/api/idle/cancel", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const result = await idleService.cancelDiscordSession(discordId, displayName);
      res.json(ok(result, "idle session canceled"));
    } catch (error) {
      const st = errStatus(error);
      if (st) {
        res.status(st).json(fail(error.code || "IDLE_CANCEL_FAILED", error.message));
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

