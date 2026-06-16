"use strict";
// 網路層防護:真實 client IP 偵測 + 全站速率限制 + SSE 長連線數上限。
// 單一程序記憶體計數即可(PM2 單 instance)。站在 Cloudflare tunnel 後面,
// 真實 IP 由 CF-Connecting-IP 提供(Cloudflare 設定,client 無法偽造);退而求其次用 X-Forwarded-For。

function getClientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return String(cf).trim();
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return String(req.socket?.remoteAddress || req.ip || "unknown");
}

// ── 全站速率限制(固定視窗,per-IP)──
function createRateLimiter({ windowMs = 10_000, max = 300 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (e.resetAt <= now) hits.delete(ip);
  }, windowMs);
  cleanup.unref?.();
  return function rateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    let e = hits.get(ip);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(ip, e); }
    e.count += 1;
    if (e.count > max) {
      res.setHeader("Retry-After", Math.ceil((e.resetAt - now) / 1000));
      return res.status(429).json({ status: "error", message: "請求太頻繁,請稍後再試。" });
    }
    return next();
  };
}

// ── SSE 長連線數上限(全域 + per-IP),防單一來源開大量常駐連線耗盡記憶體 ──
const SSE_GLOBAL_MAX = Number(process.env.SSE_GLOBAL_MAX || 3000);
const SSE_PER_IP_MAX = Number(process.env.SSE_PER_IP_MAX || 25);
let sseGlobalCount = 0;
const ssePerIp = new Map();

// 嘗試佔用一個 SSE 名額;成功回傳 release 函式,失敗(超過上限)回傳 null。
function acquireSse(req) {
  const ip = getClientIp(req);
  if (sseGlobalCount >= SSE_GLOBAL_MAX) return null;
  const c = ssePerIp.get(ip) || 0;
  if (c >= SSE_PER_IP_MAX) return null;
  ssePerIp.set(ip, c + 1);
  sseGlobalCount += 1;
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    const n = (ssePerIp.get(ip) || 1) - 1;
    if (n <= 0) ssePerIp.delete(ip); else ssePerIp.set(ip, n);
    if (sseGlobalCount > 0) sseGlobalCount -= 1;
  };
}

module.exports = { getClientIp, createRateLimiter, acquireSse, SSE_GLOBAL_MAX, SSE_PER_IP_MAX };
