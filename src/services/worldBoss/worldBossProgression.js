"use strict";

// 第一隻大史王沒有前置；活動王公開前仍受私測白名單限制。
const PREREQUISITES = Object.freeze({
  dragon_king: "default", hellfang_king: "dragon_king", steel_crown: "hellfang_king",
  island_turtle: null, northwind_hutao: null, mantou_rabbit: null,
});
const BOSS_NAMES = Object.freeze({
  default: "大史王", dragon_king: "古龍王", hellfang_king: "地獄狼牙王", steel_crown: "赫鋼王",
});
async function recordClears(repo, zoneKey, participants) {
  const { bossKeyForZone } = require("./worldBossService");
  const key = bossKeyForZone(zoneKey);
  if (!key) return;
  for (const pid of new Set(participants.filter(Boolean))) {
    const saved = await repo.updateFields(pid, { [`accountWorldBossClears.${key}`]: true });
    if (saved === false) throw new Error(`WORLD_BOSS_CLEAR_SAVE_FAILED:${key}`);
  }
}
module.exports = { PREREQUISITES, BOSS_NAMES, recordClears };
