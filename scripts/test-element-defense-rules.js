"use strict";

const assert = require("node:assert/strict");
const elementSystem = require("../src/shared/elementSystem");
const { runCombatLoop } = require("../src/shared/combatLoop");

const fireMonster = "fire";
const waterArmor = { armor: { elements: { water: 5 } } };
const fireArmor = { armor: { elements: { fire: 5 } } };

assert.deepEqual(
  elementSystem.getSameElementResist(waterArmor, fireMonster),
  { level: 0, pct: 0, mult: 1.15 },
  "水防具不應抵抗火怪"
);
assert.deepEqual(
  elementSystem.getSameElementResist(fireArmor, fireMonster),
  { level: 5, pct: 50, mult: 0.9 },
  "火防具應提供火抗"
);
assert.equal(elementSystem.getElementDamageReduction, undefined, "舊防具相剋減傷 API 應已移除");
assert.equal(elementSystem.resolveArmorElement, undefined, "防具不應再從相剋環選屬性");

const playerStats = {
  maxHp: 5000, atk: 100, def: 20, flatDef: 0,
  agi: 10, dex: 10, luk: 0, critRate: 0, dodge: 0, hit: 100,
};
const monsterStats = {
  atk: 20, def: 0, flatDef: 0, maxHp: 5000,
  agi: 1, dex: 1, luk: 0, critRate: 0, dodge: 0, hit: 100,
};
const result = runCombatLoop(playerStats, monsterStats, "火屬測試怪", 5000, 1, {
  monsterElement: fireMonster,
  monsterElementLevel: 4,
  equipped: {
    weapon: { elements: { water: 2 } },
    armor: { elements: { fire: 5, water: 5 } },
  },
  playerActiveEffects: [],
});
const opening = result.roundLogs[0];

assert.match(opening, /攻擊（武器＋副手）.*水2 剋 火.*\+20%/s);
assert.match(opening, /防禦（同屬抗性）.*防具 火5.*火抗 50%.*-10%/s);
assert.doesNotMatch(opening, /防具相剋減傷|水5 防具剋 火/);

console.log("✅ 屬性防禦規則：怪物是什麼屬性，就只用相同屬性的防具抵抗");
console.log("✅ 戰報已分開顯示武器／副手攻擊相剋與防具同屬抗性");
