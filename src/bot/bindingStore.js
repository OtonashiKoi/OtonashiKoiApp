// 直播帳號綁定碼暫存（記憶體，10 分鐘效期）
const codes = new Map(); // code -> { discordId, expiresAt }
const EXPIRY_MS = 10 * 60 * 1000;

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createCode(discordId) {
  // 若此玩家已有舊碼先移除
  for (const [k, v] of codes.entries()) {
    if (v.discordId === discordId) codes.delete(k);
  }
  const code = generateCode();
  codes.set(code, { discordId, expiresAt: Date.now() + EXPIRY_MS });
  return code;
}

function consumeCode(rawCode) {
  const code = (rawCode || "").trim().toUpperCase();
  const entry = codes.get(code);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    codes.delete(code);
    return null;
  }
  codes.delete(code);
  return entry.discordId;
}

module.exports = { createCode, consumeCode };
