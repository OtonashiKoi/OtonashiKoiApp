"use strict";

const assert = require("node:assert/strict");
const { calculateBattleTickMs, calculateWebBattleCooldownMs, calculateLiveBattleCooldownMs, WEB_BATTLE_HANDOFF_MS, WEB_DEATH_COOLDOWN_MS } = require("../src/shared/battleTiming");

assert.equal(calculateBattleTickMs(1), 1500, "新手恢復舊版 1.5 秒節奏");
assert.equal(calculateBattleTickMs(40), 500, "高 AGI 恢復舊版 0.5 秒節奏");
assert.equal(calculateBattleTickMs(60), 500, "40 AGI 後攻速封頂");
assert.equal(calculateBattleTickMs(NaN), 1500, "無效 AGI 應回退新手節奏");
assert.equal(calculateBattleTickMs(0), 1500, "低於 1 AGI 不會放慢新手節奏");
assert.equal(calculateBattleTickMs(10), 1269);
assert.equal(calculateBattleTickMs(20), 1013);
assert.equal(calculateBattleTickMs(30), 756);

const ticks = Array.from({ length: 40 }, (_, index) => calculateBattleTickMs(index + 1));
assert(ticks.every((tick, index) => index === 0 || tick < ticks[index - 1]), "AGI 1～40 應逐點加速");
assert(ticks.slice(1).every((tick, index) => [25, 26].includes(ticks[index] - tick)), "每點 AGI 線性縮短約 25.64 ms，僅有整數毫秒捨入差");

for (const agi of [1, 10, 20, 30, 40]) {
  const tickMs = calculateBattleTickMs(agi);
  const playback = calculateWebBattleCooldownMs({ roundCount: 5, perRoundMs: tickMs });
  assert.equal(playback, 5 * tickMs + WEB_BATTLE_HANDOFF_MS, "下一場等待需覆蓋完整播放時間");
  assert.equal(calculateWebBattleCooldownMs({ roundCount: 5, perRoundMs: tickMs, lost: true }), playback + WEB_DEATH_COOLDOWN_MS, "死亡懲罰不可被播放時間吃掉");
}

console.log("AGI 戰鬥節奏：1～40 線性加速（1500→500 ms）、Web 播放與冷卻一致");

assert.equal(calculateLiveBattleCooldownMs({endedAt:1000,now:1400}),1100, "settlement time overlaps handoff");
assert.equal(calculateLiveBattleCooldownMs({endedAt:1000,now:4000}),0, "late settlement adds no handoff");
assert.equal(calculateLiveBattleCooldownMs({endedAt:1000,now:1400,lost:true}),31100, "death recovery remains anchored to death");

assert.equal(calculateLiveBattleCooldownMs({endedAt:1000,now:1400,defeated:true}),1750,"650ms dissolve then 1500ms walk; settlement overlaps");
assert.equal(calculateLiveBattleCooldownMs({endedAt:1000,now:1650,defeated:true}),1500,"walking starts only after dissolve");
assert.equal(calculateLiveBattleCooldownMs({endedAt:1000,now:3150,defeated:true}),0,"no repeat wait after spawn");
assert.equal(calculateWebBattleCooldownMs({roundCount:1,perRoundMs:1200,defeated:true}),3350);
