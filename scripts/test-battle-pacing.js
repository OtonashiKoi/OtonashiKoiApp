"use strict";

const assert = require("node:assert/strict");
const { calculateBattleTickMs, calculateWebBattleCooldownMs, WEB_BATTLE_HANDOFF_MS, WEB_DEATH_COOLDOWN_MS } = require("../src/shared/battleTiming");

assert.equal(calculateBattleTickMs(1), 2400, "新手回合需留足動畫時間");
assert.equal(calculateBattleTickMs(40), 1200, "高 AGI 回合也需能看清攻擊動畫");
assert.equal(calculateBattleTickMs(60), 1200, "40 AGI 後攻速封頂");
assert.equal(calculateBattleTickMs(NaN), 2400, "無效 AGI 應回退新手節奏");

const ticks = Array.from({ length: 40 }, (_, index) => calculateBattleTickMs(index + 1));
assert(ticks.every((tick, index) => index === 0 || tick < ticks[index - 1]), "AGI 1～40 應逐點加速");
assert(ticks[0] - ticks[1] > ticks[38] - ticks[39], "前期加點應比後期更有感");

for (const agi of [1, 10, 20, 30, 40]) {
  const tickMs = calculateBattleTickMs(agi);
  const playback = calculateWebBattleCooldownMs({ roundCount: 5, perRoundMs: tickMs });
  assert.equal(playback, 5 * tickMs + WEB_BATTLE_HANDOFF_MS, "下一場等待需覆蓋完整播放時間");
  assert.equal(calculateWebBattleCooldownMs({ roundCount: 5, perRoundMs: tickMs, lost: true }), playback + WEB_DEATH_COOLDOWN_MS, "死亡懲罰不可被播放時間吃掉");
}

console.log("AGI 戰鬥節奏：1～40 單調加速、後期稀釋、Web 播放與冷卻一致");
