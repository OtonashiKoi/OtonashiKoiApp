"use strict";

const assert = require("node:assert/strict");
const {
  getElementMultiplier,
  resolveWeaponElement,
} = require("../src/shared/elementSystem");
const { runCombatLoop } = require("../src/shared/combatLoop");

// 攻方發動克制：只看攻方濃度。
assert.equal(getElementMultiplier("water", "fire", 5, 2), 1.5, "水5剋火2應為150%");

// 守方發動克制：只看守方濃度，不看攻方的劣勢屬性有多高。
assert.equal(getElementMultiplier("fire", "water", 5, 2), 0.8, "火5打水2應為80%");
assert.equal(getElementMultiplier("fire", "water", 1, 5), 0.5, "火1打水5應為50%");
assert.equal(getElementMultiplier("water", "water", 5, 5), 1, "同屬性應為100%");

// 多屬性自動選擇：剋制 > 中性 > 被剋。
assert.deepEqual(
  resolveWeaponElement({ weapon: { elements: { water: 5, fire: 5 } } }, "water"),
  { element: "water", level: 5, relation: "neutral" },
  "水5火5打水怪應選水5中性，不應選火5吃劣勢"
);
assert.deepEqual(
  resolveWeaponElement({ weapon: { elements: { earth: 2, water: 5, fire: 5 } } }, "water"),
  { element: "earth", level: 2, relation: "advantage" },
  "只要有剋制屬性，就應優先於更高等的中性屬性"
);
assert.deepEqual(
  resolveWeaponElement({ weapon: { elements: { fire: 5 } } }, "water"),
  { element: "fire", level: 5, relation: "disadvantage" },
  "只剩被剋屬性時才套用劣勢"
);

const playerStats = {
  maxHp: 5000, atk: 100, def: 20, flatDef: 0,
  agi: 10, dex: 10, luk: 0, critRate: 0, dodge: 0, hit: 100,
};
const monsterStats = {
  atk: 20, def: 0, flatDef: 0, maxHp: 5000,
  agi: 1, dex: 1, luk: 0, critRate: 0, dodge: 0, hit: 100,
};
function openingFor(elements, monsterElement, monsterElementLevel) {
  return runCombatLoop(playerStats, monsterStats, "屬性測試怪", 5000, 1, {
    monsterElement,
    monsterElementLevel,
    equipped: { weapon: { elements } },
    playerActiveEffects: [],
  }).roundLogs[0];
}

assert.match(
  openingFor({ fire: 5 }, "water", 2),
  /水2 剋 火5.*對敵傷害 \*\*−20%\*\*/s,
  "實戰戰報的劣勢減幅必須顯示守方水2，而不是攻方火5"
);
assert.match(
  openingFor({ water: 5, fire: 5 }, "water", 5),
  /自動選擇 水5（中性）.*對敵傷害 \*\*±0%\*\*/s,
  "實戰遇到多屬性時應先選中性，不能選被剋屬性"
);

console.log("✅ 屬性相剋已改為攻方看攻方濃度、守方看守方濃度");
console.log("✅ 多屬性選擇順序：剋制 ＞ 中性 ＞ 被剋");
