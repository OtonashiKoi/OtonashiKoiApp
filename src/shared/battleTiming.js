"use strict";

// 網頁端收到戰鬥結果後，會先建立動畫時間軸再開始播放。
// 只保留 0.5 秒做畫面交接，避免舊的固定 2 秒緩衝在每場排隊間形成空窗。
const WEB_BATTLE_HANDOFF_MS = 500;
const WEB_DEATH_COOLDOWN_MS = 30 * 1000;

function calculateWebBattleCooldownMs({ roundCount, perRoundMs, lost = false }) {
  const rounds = Math.max(0, Math.floor(Number(roundCount) || 0));
  const tickMs = Math.max(0, Math.floor(Number(perRoundMs) || 0));
  const playbackMs = rounds * tickMs + WEB_BATTLE_HANDOFF_MS;
  // 伺服器在玩家按下出戰時就先算完整場戰鬥，但死亡懲罰的語意是「死亡後 30 秒」。
  // 因此前端尚在播放戰報的時間只能用來保護戰鬥互斥，不能吃掉死亡懲罰。
  return playbackMs + (lost ? WEB_DEATH_COOLDOWN_MS : 0);
}

module.exports = {
  WEB_BATTLE_HANDOFF_MS,
  WEB_DEATH_COOLDOWN_MS,
  calculateWebBattleCooldownMs,
};
