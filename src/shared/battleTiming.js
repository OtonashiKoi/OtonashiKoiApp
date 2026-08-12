"use strict";

// 網頁端收到戰鬥結果後，會先建立動畫時間軸再開始播放。
// 只保留 0.5 秒做畫面交接，避免舊的固定 2 秒緩衝在每場排隊間形成空窗。
const WEB_BATTLE_HANDOFF_MS = 500;
const WEB_DEATH_COOLDOWN_MS = 30 * 1000;

function calculateWebBattleCooldownMs({ roundCount, perRoundMs, lost = false }) {
  // 死亡懲罰是獨立遊戲規則：固定 30 秒，不得混入 AGI、回合數或動畫交接時間。
  if (lost) return WEB_DEATH_COOLDOWN_MS;
  const rounds = Math.max(0, Math.floor(Number(roundCount) || 0));
  const tickMs = Math.max(0, Math.floor(Number(perRoundMs) || 0));
  return rounds * tickMs + WEB_BATTLE_HANDOFF_MS;
}

module.exports = {
  WEB_BATTLE_HANDOFF_MS,
  WEB_DEATH_COOLDOWN_MS,
  calculateWebBattleCooldownMs,
};
