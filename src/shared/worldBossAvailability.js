"use strict";
// 僅三隻活動王暫停；其餘世界王維持原設定。
const CLOSED_BOSS_KEYS = Object.freeze(["island_turtle", "northwind_hutao", "mantou_rabbit"]);
module.exports = { CLOSED_BOSS_KEYS, CLOSED_REASON: "活動世界王暫停開放，請等待公告。" };
