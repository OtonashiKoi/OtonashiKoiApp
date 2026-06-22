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

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ status: "error", message: "Missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // 被管理員封鎖網頁使用權的玩家 → 一律擋下（回 403，前端清 token 跳登入）
    if (isBlocked(decoded?.discordId)) {
      return res.status(403).json({ status: "error", code: "WEB_BLOCKED", message: "你的帳號已被管理員封鎖網頁使用權限。" });
    }
    req.playerRecord = decoded; // { discordId, displayName }
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
