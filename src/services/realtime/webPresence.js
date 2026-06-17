"use strict";
/**
 * 網頁在線狀態:追蹤目前連著 /api/me/stream SSE 的玩家。
 * 供後台列出「此刻正在用網頁的人」,方便挑選要強制登出/重整/封鎖的對象。
 * 純記憶體(連線即時),不持久化。
 */

const online = new Map(); // discordId -> { discordId, displayName, connections, firstAt, lastAt }

function add(discordId, displayName) {
  const id = String(discordId || "").trim();
  if (!id) return;
  const now = Date.now();
  const cur = online.get(id);
  if (cur) {
    cur.connections += 1;
    cur.lastAt = now;
    if (displayName) cur.displayName = displayName;
  } else {
    online.set(id, { discordId: id, displayName: displayName || id, connections: 1, firstAt: now, lastAt: now });
  }
}

function remove(discordId) {
  const id = String(discordId || "").trim();
  const cur = online.get(id);
  if (!cur) return;
  cur.connections -= 1;
  if (cur.connections <= 0) online.delete(id);
}

/** 目前在線玩家(依最近活動排序) */
function list() {
  return [...online.values()].sort((a, b) => b.lastAt - a.lastAt);
}

module.exports = { add, remove, list };
