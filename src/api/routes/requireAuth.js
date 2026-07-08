"use strict";
/**
 * 共用 JWT 驗證 middleware。
 * 行為與 playerAppRoutes 原本的內嵌版本完全一致：
 *   - 讀 Authorization: Bearer <token>
 *   - 用 JWT_SECRET 驗證後把 decoded payload 掛在 req.playerRecord（{ discordId, displayName }）
 *   - 失敗回 401 { status: "error", message }
 * 新的玩家端 route 檔案請直接 require 本模組，不要再各自複製一份。
 */

const jwt = require("jsonwebtoken");
const { isBlocked } = require("../../services/access/webBanStore");
const maintenance = require("../../services/access/maintenanceStore");
const sessionCutoff = require("../../services/access/sessionCutoffStore");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ status: "error", message: "Missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // 全服強制重新登入：token 發出時間早於門檻 → 作廢，回 401（前端清 token 跳登入）
    const cutoff = sessionCutoff.getCutoff();
    if (cutoff && decoded?.iat && decoded.iat < cutoff) {
      return res.status(401).json({ status: "error", code: "SESSION_RESET", message: "系統已要求重新登入，請重新登入。" });
    }
    // 被管理員封鎖網頁使用權的玩家 → 一律擋下（回 403，前端清 token 跳登入）
    if (isBlocked(decoded?.discordId)) {
      return res.status(403).json({ status: "error", code: "WEB_BLOCKED", message: "你的帳號已被管理員封鎖網頁使用權限。" });
    }
    // 賽季結束維護中 → 非白名單玩家一律擋下（前端顯示賽季結束頁 + DC 邀請）
    if (maintenance.isActive() && !maintenance.isWhitelisted(decoded?.discordId)) {
      const info = maintenance.getPublicInfo();
      return res.status(403).json({ status: "error", code: "SEASON_ENDED", message: info.message, title: info.title, inviteUrl: info.inviteUrl });
    }
    req.playerRecord = decoded; // { discordId, displayName }
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
