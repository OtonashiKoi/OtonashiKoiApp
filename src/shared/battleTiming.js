"use strict";

// 網頁端收到戰鬥結果後，會先建立動畫時間軸再開始播放。
// 戰後保留 1.5 秒做畫面交接與前往下一場的步伐動畫。
const WEB_BATTLE_HANDOFF_MS = 1500;
const MONSTER_DISSOLVE_MS = 650;
const WEB_MONSTER_TRANSITION_MS = MONSTER_DISSOLVE_MS + WEB_BATTLE_HANDOFF_MS;
const WEB_DEATH_COOLDOWN_MS = 30 * 1000;

// 一個回合包含玩家攻擊與怪物反應；AGI 只縮短回合時槽，不額外產生回合。
// AGI 1～40 線性加速：1500 ms → 500 ms；AGI 40 後不再加速。
function calculateBattleTickMs(agi = 1) {
  const value = Number(agi);
  const capped = Math.min(40, Math.max(1, Number.isFinite(value) ? value : 1));
  const progress = (capped - 1) / 39;
  return Math.round(1500 - 1000 * progress);
}

function calculateWebBattleCooldownMs({ roundCount, perRoundMs, lost = false, defeated = false }) {
  const rounds = Math.max(0, Math.floor(Number(roundCount) || 0));
  const tickMs = Math.max(0, Math.floor(Number(perRoundMs) || 0));
  const playbackMs = rounds * tickMs + WEB_BATTLE_HANDOFF_MS + (defeated ? MONSTER_DISSOLVE_MS : 0);
  // 伺服器在玩家按下出戰時就先算完整場戰鬥，但死亡懲罰的語意是「死亡後 30 秒」。
  // 因此前端尚在播放戰報的時間只能用來保護戰鬥互斥，不能吃掉死亡懲罰。
  return playbackMs + (lost ? WEB_DEATH_COOLDOWN_MS : 0);
}

function calculateLiveBattleCooldownMs({ endedAt, now, lost = false, defeated = false }) {
  const end = Number(endedAt);
  const anchor = Number.isFinite(end) && end > 0 ? end : now;
  return Math.max(0, anchor + WEB_BATTLE_HANDOFF_MS + (defeated ? MONSTER_DISSOLVE_MS : 0) + (lost ? WEB_DEATH_COOLDOWN_MS : 0) - now);
}

module.exports = {
  calculateLiveBattleCooldownMs,
  WEB_BATTLE_HANDOFF_MS,
  MONSTER_DISSOLVE_MS,
  WEB_MONSTER_TRANSITION_MS,
  WEB_DEATH_COOLDOWN_MS,
  calculateBattleTickMs,
  calculateWebBattleCooldownMs,
};
