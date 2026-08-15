"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Router } = require("express");
const config = require("../config");
const { ok, fail } = require("../shared/response");

const COOKIE_NAME = "otonashi_admin_session";
const SESSION_HOURS = 12;

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET
    || process.env.JWT_SECRET
    || config.streamAuth?.stateSecret
    || config.api.adminPassword;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((out, part) => {
    const index = part.indexOf("=");
    if (index < 0) return out;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
    return out;
  }, {});
}

function verifySession(req) {
  const token = readCookies(req)[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, sessionSecret());
    return payload?.purpose === "admin-session" ? payload : null;
  } catch (_) {
    return null;
  }
}

function cookieOptions(req) {
  const secure = process.env.NODE_ENV === "production"
    || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  return ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_HOURS * 60 * 60}`, secure ? "Secure" : ""]
    .filter(Boolean).join("; ");
}

function createAdminSessionRoutes() {
  const router = Router();
  router.post("/api/admin/session/login", (req, res) => {
    if (!safeEqual(req.body?.password, config.api.adminPassword)) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "管理員密碼錯誤。"));
      return;
    }
    const token = jwt.sign({ sub: "owner", role: "owner", scopes: ["*"], purpose: "admin-session" }, sessionSecret(), { expiresIn: `${SESSION_HOURS}h` });
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(req)}`);
    res.json(ok({ authenticated: true, role: "owner", scopes: ["*"], expiresInHours: SESSION_HOURS }, "admin session created"));
  });
  router.get("/api/admin/session", (req, res) => {
    const session = verifySession(req);
    if (!session) {
      res.status(401).json(fail("ADMIN_SESSION_REQUIRED", "管理員工作階段不存在或已過期。"));
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(ok({ authenticated: true, role: session.role, scopes: session.scopes || [] }, "admin session active"));
  });
  router.delete("/api/admin/session", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json(ok({ authenticated: false }, "admin session cleared"));
  });
  return router;
}

function adminSessionBridge(req, _res, next) {
  const session = verifySession(req);
  if (session) {
    req.adminActor = { id: session.sub || "owner", role: session.role || "owner", scopes: session.scopes || ["*"] };
    req.headers.authorization = `Bearer ${config.api.adminPassword}`;
  } else {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (safeEqual(token, config.api.adminPassword)) req.adminActor = { id: "legacy-password", role: "owner", scopes: ["*"] };
  }
  next();
}

function createAdminAuditMiddleware(serviceContext) {
  const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const ignored = new Set(["/admin/live/test-alert"]);
  return function auditAdminRequest(req, res, next) {
    const path = req.originalUrl.split("?")[0];
    // 這兩個舊有玩家發放 API 已由 AdminService 寫入包含完整數值的稽核紀錄，避免重複兩筆。
    const hasDetailedServiceAudit = /^\/admin\/players\/[^/]+\/(grant|grant-exp)$/.test(path);
    if (!mutating.has(req.method) || ignored.has(path) || hasDetailedServiceAudit) return next();
    const startedAt = Date.now();
    res.on("finish", () => {
      const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {};
      const targetMatch = req.originalUrl.match(/\/players\/([^/?]+)/);
      const entry = {
        adminId: req.adminActor?.id || "unknown-admin",
        targetPlayerId: targetMatch ? decodeURIComponent(targetMatch[1]) : null,
        actionType: `http:${req.method.toLowerCase()}`,
        payload: {
          path, statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          bodyKeys: Object.keys(body).filter((key) => !/password|token|secret|authorization/i.test(key)).slice(0, 30)
        },
        createdAt: new Date().toISOString()
      };
      Promise.resolve(serviceContext.adminActionLogRepository?.append(entry)).catch((error) => {
        console.warn("[AdminAudit] append failed:", error?.message || error);
      });
    });
    next();
  };
}

module.exports = { createAdminSessionRoutes, adminSessionBridge, createAdminAuditMiddleware, verifySession };
