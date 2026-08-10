"use strict";

const assert = require("node:assert/strict");
const { getElementCombatProfile } = require("../src/shared/elementSystem");

const profile = getElementCombatProfile({
  weapon: { elements: { water: 3, fire: 2 } },
  shield: { elements: { water: 3 } },
  armor: { elements: { fire: 5, water: 3 } },
  garment: { elements: { fire: 2 } },
});

const water = profile.elements.find((row) => row.element === "water");
const fire = profile.elements.find((row) => row.element === "fire");
const wood = profile.elements.find((row) => row.element === "wood");

assert.deepEqual(
  { level: water.attackLevel, raw: water.attackRawLevel, min: water.attackMinDamagePct, max: water.attackMaxDamagePct },
  { level: 5, raw: 6, min: 50, max: 150 },
  "攻擊屬性應合計武器＋副手並封頂 Lv5"
);
assert.deepEqual(
  { level: fire.resistLevel, pct: fire.resistPct, taken: fire.damageTakenPct, mult: fire.damageTakenMult },
  { level: 7, pct: 70, taken: 80, mult: 0.8 },
  "火7 防具受到火傷應為 80%（×0.80）"
);
assert.deepEqual(
  { level: water.resistLevel, pct: water.resistPct, taken: water.damageTakenPct },
  { level: 3, pct: 30, taken: 100 },
  "水3 防具應抵銷無抗懲罰，回到正常承傷"
);
assert.deepEqual(
  { level: wood.resistLevel, pct: wood.resistPct, taken: wood.damageTakenPct },
  { level: 0, pct: 0, taken: 115 },
  "未準備木抗時受到木傷應為 115%"
);
assert.deepEqual(profile.attackLimits, {
  minLevel: 0, maxLevel: 5, neutralDamagePct: 100,
  minDamagePct: 50, maxDamagePct: 150, perLevelPct: 10,
  maxAdvantageBonusPct: 50, maxDisadvantagePenaltyPct: 50,
});
assert.deepEqual(profile.resistLimits, {
  minLevel: 0, maxLevel: 10, minResistPct: 0, maxResistPct: 100,
  unpreparedDamageTakenPct: 115, neutralDamageTakenPct: 100,
  fullDamageTakenPct: 65, breakEvenLevel: 3, perLevelDamagePct: 5,
});

console.log("✅ 首頁七屬性總覽與戰鬥公式一致");
