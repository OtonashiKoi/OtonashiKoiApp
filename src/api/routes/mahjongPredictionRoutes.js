"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Router } = require("express");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function deriveMahjongJwtSecret(baseSecret) {
  const secret = String(baseSecret || "");
  if (!secret) throw new Error("JWT_SECRET is required");
  return crypto.createHash("sha256").update(`${secret}:mahjong_prediction`).digest("hex");
}

function mahjongJwtSecret() {
  return deriveMahjongJwtSecret(config.api?.jwtSecret || process.env.JWT_SECRET);
}

function createMahjongPredictionRoutes(serviceContext) {
  const router = Router();
  const service = serviceContext.mahjongPredictionService;

  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (!safeEqual(token, config.api.adminPassword)) {
      return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "管理員工作階段不存在或已過期。"));
    }
    next();
  }

  function publicBaseUrl(req) {
    const configured = String(config.api?.publicBaseUrl || "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  }

  function mahjongRedirectUri(req) {
    return `${publicBaseUrl(req)}/auth/discord/callback`;
  }

  function requireMahjongAuth(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (!token) return res.status(401).json(fail("MAHJONG_AUTH_REQUIRED", "請先登入戀雀預測。"));
    try {
      const decoded = jwt.verify(token, mahjongJwtSecret());
      if (decoded?.scope !== "mahjong_prediction" || !decoded?.discordId) throw new Error("invalid scope");
      req.playerRecord = decoded;
      next();
    } catch (_) {
      return res.status(401).json(fail("MAHJONG_AUTH_INVALID", "戀雀登入已過期，請重新登入。"));
    }
  }

  function player(req) {
    return { playerId: String(req.playerRecord.discordId), displayName: req.playerRecord.displayName || String(req.playerRecord.discordId) };
  }

  function badRequest(res, error, code = "MAHJONG_PREDICTION_FAILED") {
    return res.status(400).json(fail(code, error?.message || "操作失敗。"));
  }

  router.get("/api/mahjong-auth/discord/login", (req, res) => {
    try {
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).json(fail("MAHJONG_AUTH_UNAVAILABLE", "Discord 登入尚未設定完成。"));
      }
      const signedState = jwt.sign({ purpose: "mahjong_prediction_oauth" }, mahjongJwtSecret(), { expiresIn: "10m" });
      const url = new URL("https://discord.com/api/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: auth.clientId,
        redirect_uri: mahjongRedirectUri(req),
        response_type: "code",
        scope: "identify",
        prompt: "consent",
        state: `koi.${signedState}`,
      }).toString();
      return res.redirect(url.toString());
    } catch (error) {
      return badRequest(res, error, "MAHJONG_AUTH_START_FAILED");
    }
  });

  router.post("/api/mahjong-auth/discord", async (req, res, next) => {
    try {
      const code = String(req.body?.code || "").trim();
      const state = String(req.body?.state || "").trim();
      if (!code || !state.startsWith("koi.")) return badRequest(res, new Error("缺少戀雀 Discord 授權資料。"), "MAHJONG_AUTH_INVALID");
      const statePayload = jwt.verify(state.slice(4), mahjongJwtSecret());
      if (statePayload?.purpose !== "mahjong_prediction_oauth") throw new Error("戀雀登入驗證已失效。請重新登入。");
      const auth = config.discord || {};
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: mahjongRedirectUri(req),
        }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Discord 授權交換失敗，請重新登入。");
      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const user = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || !user.id) throw new Error("無法取得 Discord 使用者資料。");
      const displayName = String(user.global_name || user.username || "戀雀玩家").slice(0, 80);
      const token = jwt.sign({ discordId: String(user.id), displayName, scope: "mahjong_prediction" }, mahjongJwtSecret(), { expiresIn: "7d" });
      return res.json(ok({ token, discordId: String(user.id), displayName }));
    } catch (error) {
      if (error?.message) return badRequest(res, error, "MAHJONG_AUTH_FAILED");
      next(error);
    }
  });

  router.get("/api/mahjong-prediction/state", requireMahjongAuth, async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(ok(await service.getPlayerState(player(req))));
    } catch (error) { next(error); }
  });

  router.post("/api/mahjong-prediction/daily", requireMahjongAuth, async (req, res, next) => {
    try { res.json(ok(await service.claimDaily(player(req)), "每日戀雀券已領取")); }
    catch (error) { if (error?.message) return badRequest(res, error, "DAILY_CLAIM_FAILED"); next(error); }
  });

  router.post("/api/mahjong-prediction/activate", requireMahjongAuth, async (req, res, next) => {
    try { res.json(ok(await service.activateWallet(player(req)), "戀雀券錢包已啟用")); }
    catch (error) { if (error?.message) return badRequest(res, error, "WALLET_ACTIVATE_FAILED"); next(error); }
  });

  router.post("/api/mahjong-prediction/bets", requireMahjongAuth, async (req, res, next) => {
    try {
      res.json(ok(await service.placeBet({ ...player(req), marketId: req.body?.marketId, optionId: req.body?.optionId, amount: req.body?.amount }), "投注成功"));
    } catch (error) { if (error?.message) return badRequest(res, error, error?.code || "BET_FAILED"); next(error); }
  });

  router.get("/api/mahjong-prediction/overlay", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(ok(await service.getOverlayState()));
    } catch (error) { next(error); }
  });

  router.get("/admin/mahjong-prediction/state", requireAdmin, async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(ok(await service.getAdminState()));
    } catch (error) { next(error); }
  });

  router.post("/admin/mahjong-prediction/markets", requireAdmin, async (req, res, next) => {
    try { res.json(ok(await service.createMarket(req.body), "盤口已開放")); }
    catch (error) { if (error?.message) return badRequest(res, error, "MARKET_CREATE_FAILED"); next(error); }
  });

  router.post("/admin/mahjong-prediction/lock", requireAdmin, async (_req, res, next) => {
    try { res.json(ok(await service.lockCurrentMarket(), "盤口已封盤")); }
    catch (error) { if (error?.message) return badRequest(res, error, "MARKET_LOCK_FAILED"); next(error); }
  });

  router.post("/admin/mahjong-prediction/settle", requireAdmin, async (req, res, next) => {
    try { res.json(ok(await service.settleCurrentMarket(req.body), "盤口結算完成")); }
    catch (error) { if (error?.message) return badRequest(res, error, "MARKET_SETTLE_FAILED"); next(error); }
  });

  router.post("/admin/mahjong-prediction/void", requireAdmin, async (req, res, next) => {
    try { res.json(ok(await service.voidCurrentMarket(req.body), "盤口已作廢並全額退款")); }
    catch (error) { if (error?.message) return badRequest(res, error, "MARKET_VOID_FAILED"); next(error); }
  });

  return router;
}

module.exports = { createMahjongPredictionRoutes, deriveMahjongJwtSecret };
