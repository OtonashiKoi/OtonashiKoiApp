"use strict";
/**
 * 聊天大廳「最近發言」追蹤(記憶體)。
 * 玩家在城鎮聊天大廳(網頁或 Discord)發言時 markSpoke,
 * 供戰鬥畫面的玩家氣泡顯示「講話中」與短摘要。
 */

const spoke = new Map(); // discordId -> { at, preview }
const MAX = 3000;

function makePreview(message) {
  const clean = String(message || "")
    .replace(/<@!?\d+>/g, "@玩家")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const chars = Array.from(clean);
  return chars.slice(0, 6).join("") + (chars.length > 6 ? "…" : "");
}

function markSpoke(discordId, message = "") {
  const id = String(discordId || "").trim();
  if (!id) return;
  spoke.set(id, { at: Date.now(), preview: makePreview(message) });
  if (spoke.size > MAX) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [k, v] of spoke) if (v.at < cutoff) spoke.delete(k);
  }
}

function isSpeaking(discordId, windowMs = 45000) {
  const entry = spoke.get(String(discordId || "").trim());
  return !!entry && (Date.now() - entry.at) < windowMs;
}

function getPreview(discordId, windowMs = 45000) {
  const entry = spoke.get(String(discordId || "").trim());
  return entry && (Date.now() - entry.at) < windowMs ? entry.preview : "";
}

module.exports = { markSpoke, isSpeaking, getPreview };
