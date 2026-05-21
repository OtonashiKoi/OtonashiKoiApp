/**
 * 玩家事件 bus — 任何寫入 progress / wallet / inventory / binding 等的 service
 * 都可以呼叫 emit(discordId, event) 把變動推給該玩家所有訂閱中的 SSE 連線。
 *
 * 用途：讓 web client 不用 polling 也能即時知道資料變了。
 *
 * 事件格式：
 *   { type: "profile_invalidate" }  → client 重抓 /api/me/profile
 *   { type: "bindings_invalidate" } → client 重抓 /api/me/bindings
 *   { type: "battle_lock_changed", data: { locked: bool, source } }
 *   { type: "inventory_invalidate" }
 *   { type: "notice", data: { title, body } }   → 顯示通知 toast
 */

const { EventEmitter } = require("events");

class PlayerEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0); // 不限制 listener 數量（每個 SSE 連線一個）
  }

  /**
   * 推送事件給特定玩家
   * @param {string} discordId
   * @param {{ type: string, data?: any }} event
   */
  emit(discordId, event) {
    if (!discordId) return;
    super.emit(`player:${discordId}`, event);
    super.emit("any", { discordId, event });
  }

  /**
   * 訂閱特定玩家的事件
   */
  subscribe(discordId, handler) {
    const channel = `player:${discordId}`;
    super.on(channel, handler);
    return () => super.off(channel, handler);
  }

  /**
   * 推「重抓 profile」訊號（最常用）
   */
  invalidateProfile(discordId, reason = "data_changed") {
    this.emit(discordId, { type: "profile_invalidate", data: { reason } });
  }

  invalidateBindings(discordId) {
    this.emit(discordId, { type: "bindings_invalidate" });
  }

  invalidateInventory(discordId) {
    this.emit(discordId, { type: "inventory_invalidate" });
  }

  /**
   * 推送 toast 通知
   */
  notice(discordId, { title, body, kind = "info" }) {
    this.emit(discordId, { type: "notice", data: { title, body, kind } });
  }
}

const playerEventBus = new PlayerEventBus();

module.exports = { playerEventBus, PlayerEventBus };
