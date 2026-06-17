"use strict";
/**
 * 聊天大廳「最近發言」追蹤(記憶體)。
 * 玩家在城鎮聊天大廳(網頁或 Discord)發言時 markSpoke,
 * 供戰鬥畫面的玩家氣泡顯示「講話中」圖示(只看有沒有講,不看內容)。
 */

const spoke = new Map(); // discordId -> lastSpokeAtMs
const MAX = 3000;

function markSpoke(discordId) {
  const id = String(discordId || "").trim();
  if (!id) return;
  spoke.set(id, Date.now());
  if (spoke.size > MAX) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [k, v] of spoke) if (v < cutoff) spoke.delete(k);
  }
}

function isSpeaking(discordId, windowMs = 45000) {
  const t = spoke.get(String(discordId || "").trim());
  return !!t && (Date.now() - t) < windowMs;
}

module.exports = { markSpoke, isSpeaking };
