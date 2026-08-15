"use strict";

const assert = require("node:assert/strict");
const {
  WEB_BATTLE_HANDOFF_MS,
  WEB_DEATH_COOLDOWN_MS,
  calculateWebBattleCooldownMs,
} = require("../src/shared/battleTiming");

for (const sample of [
  { rounds: 1, tickMs: 1500 },
  { rounds: 6, tickMs: 900 },
  { rounds: 15, tickMs: 500 },
]) {
  const playbackMs = sample.rounds * sample.tickMs + WEB_BATTLE_HANDOFF_MS;
  const alive = calculateWebBattleCooldownMs({ roundCount: sample.rounds, perRoundMs: sample.tickMs });
  const dead = calculateWebBattleCooldownMs({ roundCount: sample.rounds, perRoundMs: sample.tickMs, lost: true });
  assert.equal(alive, playbackMs, "存活戰鬥只應鎖到動畫播放完成");
  assert.equal(dead - playbackMs, WEB_DEATH_COOLDOWN_MS, "死亡畫面出現後必須仍有完整 30 秒懲罰");
}

console.log("✅ Web 死亡懲罰會在戰鬥播放完成後才開始完整倒數 30 秒");
