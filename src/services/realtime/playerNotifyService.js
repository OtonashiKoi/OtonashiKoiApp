"use strict";
/**
 * 統一玩家通知 helper。
 * 一次呼叫同時走兩條既有通道：
 *   1. playerEventBus — SSE `/api/me/stream?token=` 即時推播（事件 type: "notify"）
 *   2. notifQueue — `/api/notifications/poll` 輪詢備援佇列；
 *      enqueue 函式由 playerAppRoutes 啟動時掛在
 *      serviceContext._enqueueNotif / serviceContext._enqueueNotifAll 上
 *      （與既有 _pushRewardToPlayer 同一模式）。
 *
 * 統一 payload 形狀：{ type, title, message, ts, meta? }
 *   - type    事件類型（如 auction_sold / casino_round / worldboss_respawn …）
 *   - title   通知標題（繁體中文）
 *   - message 通知內文（繁體中文）
 *   - ts      毫秒 timestamp
 *   - meta    附加結構化資料（可選）
 */

const { playerEventBus } = require("./playerEventBus");

function _buildPayload(type, title, message, meta) {
  return {
    type: String(type || "notice"),
    title: String(title || ""),
    message: String(message || ""),
    ts: Date.now(),
    ...(meta && typeof meta === "object" ? { meta } : {})
  };
}

function _serviceContext() {
  // 延遲 require，避免循環依賴（runtimeContext → createServiceContext → 各 service）
  try {
    return require("../../bot/runtimeContext").serviceContext;
  } catch (_) {
    return null;
  }
}

/**
 * 通知單一玩家（SSE + 輪詢佇列）
 * @param {string} discordId
 * @param {{ type: string, title?: string, message?: string, meta?: object }} input
 * @returns {object|null} 實際送出的 payload
 */
function notifyPlayer(discordId, { type, title, message, meta } = {}) {
  const id = String(discordId || "").trim();
  if (!id || !type) return null;
  const payload = _buildPayload(type, title, message, meta);

  // 1. SSE 即時推播
  try {
    playerEventBus.emit(id, { type: "notify", data: payload });
  } catch (_) { /* 通知失敗不影響主流程 */ }

  // 2. 輪詢備援佇列（API server 啟動後才會掛上）
  try {
    const sc = _serviceContext();
    if (typeof sc?._enqueueNotif === "function") sc._enqueueNotif(id, payload);
  } catch (_) { /* 同上 */ }

  return payload;
}

/**
 * 廣播通知（例：世界王重生）。
 * 對象＝目前有 SSE 連線的玩家 ＋ 曾經輪詢過通知的玩家（notifQueue 既有 key）。
 * @param {{ type: string, title?: string, message?: string, meta?: object }} input
 * @returns {object|null} 實際送出的 payload
 */
function notifyAllPlayers({ type, title, message, meta } = {}) {
  if (!type) return null;
  const payload = _buildPayload(type, title, message, meta);

  // 1. SSE：掃 bus 上所有 player:<discordId> 訂閱頻道逐一推送
  try {
    for (const name of playerEventBus.eventNames()) {
      const channel = String(name);
      if (!channel.startsWith("player:")) continue;
      const id = channel.slice("player:".length);
      try {
        playerEventBus.emit(id, { type: "notify", data: payload });
      } catch (_) { /* 單一玩家失敗不影響其他 */ }
    }
  } catch (_) { /* 通知失敗不影響主流程 */ }

  // 2. 輪詢佇列廣播（由 playerAppRoutes 掛上）
  try {
    const sc = _serviceContext();
    if (typeof sc?._enqueueNotifAll === "function") sc._enqueueNotifAll(payload);
  } catch (_) { /* 同上 */ }

  return payload;
}

module.exports = { notifyPlayer, notifyAllPlayers };
