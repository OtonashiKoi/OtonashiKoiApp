"use strict";
const CLOSED_BOSS_KEYS = Object.freeze(["island_turtle", "mantou_rabbit"]);
function isBossClosed(bossKey, now = Date.now()) {
  return module.exports.CLOSED_BOSS_KEYS.includes(bossKey) || (bossKey === "northwind_hutao" && !require("./hutaoActivity").isOpen(now));
}
module.exports = { CLOSED_BOSS_KEYS, isBossClosed, CLOSED_REASON: "活動世界王目前未開放。" };
