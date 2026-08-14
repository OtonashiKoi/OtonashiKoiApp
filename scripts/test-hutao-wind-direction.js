"use strict";

const assert = require("node:assert/strict");
const { runCombatLoop } = require("../src/shared/combatLoop");
const {
  EFFECT_KEY,
  phaseAt,
  normalizeStep,
  hasEffect,
} = require("../src/shared/windDirection");
const {
  canPlayerAccessZone,
  getVisibleZoneKeys,
  getPublicZoneKeys,
  isZoneVisibleInBestiary,
} = require("../src/shared/zones");

const effect = {
  key: EFFECT_KEY,
  trigger: "passive",
  target: "self",
  params: { eastHit: 10, southFinalDamagePct: 8, westCritDamagePct: 20, northCritRatePct: 15 },
};
const equipped = {
  weapon: { itemId: "hutao-wind-sword-1h", itemName: "東風・青龍雀劍", passiveEffects: [effect], weaponType: "sword_1h" },
  shield: { itemId: "hutao-wind-offhand-sword", itemName: "對子・雙風脇差", passiveEffects: [effect], weaponType: "offhand_sword" },
};

assert.equal(hasEffect(equipped), true);
assert.equal(phaseAt(0, 0).key, "east");
assert.equal(phaseAt(0, 3).key, "north");
assert.equal(phaseAt(3, 1).key, "east");
assert.equal(normalizeStep(-1), 3);

const previewId = "865264891991425055";
assert.equal(canPlayerAccessZone("event_boss_hutao_preview", previewId), true);
assert.equal(canPlayerAccessZone("event_boss_hutao_preview", "123"), false);
assert.equal(getVisibleZoneKeys(previewId).includes("event_boss_hutao_preview"), true);
assert.equal(getVisibleZoneKeys("123").includes("event_boss_hutao_preview"), false);
assert.equal(getPublicZoneKeys().includes("event_boss_hutao_preview"), false);
assert.equal(getPublicZoneKeys().includes("event_boss"), true);
assert.equal(isZoneVisibleInBestiary("event_boss_hutao_preview"), false);
assert.equal(isZoneVisibleInBestiary("event_boss"), true);

const pStats = {
  level: 65,
  str: 50, agi: 50, vit: 50, int: 20, dex: 50, luk: 20,
  maxHp: 999999,
  atk: 100,
  weaponMainStat: "str",
  weaponMainStatValue: 50,
  dmgMin: 1,
  dmgMax: 1,
  def: 0,
  flatDef: 0,
  dodge: 0,
  hit: 100,
  crit: 0,
  combo: 0,
  comboDamageMultiplier: 1,
  tierDamageMultiplier: 1,
  tierFinalDamageMultiplier: 1,
  tierBossDamageMultiplier: 1,
  tierCritDamageMultiplier: 1,
  weaponType: "sword_1h",
  isTwoHanded: false,
  bypassMonsterDefPct: 0,
  monsterAttackCount: 1,
  attackSegments: 1,
  blockChance: 0,
  counterChance: 0,
};
const mCalc = {
  level: 1,
  maxHp: 99999999,
  atk: 1,
  def: 0,
  flatDef: 0,
  agi: 1,
  dex: 1,
  luk: 0,
  int: 1,
  dodge: 0,
  hit: 1,
  critRate: 0,
  comboChance: 0,
  blockChance: 0,
  damageReductionPct: 0,
};

const originalRandom = Math.random;
Math.random = () => 0.5;
let result;
try {
  result = runCombatLoop(pStats, mCalc, "測試木樁", mCalc.maxHp, 4, {
    equipped,
    inventory: [],
    windDirectionStep: 2,
    skipMonsterAttack: true,
  });
} finally {
  Math.random = originalRandom;
}

assert.equal(result.windDirectionRoundsProcessed, 4);
assert.equal(result.windDirectionStep, 2, "西風起手跑四回合後應回到西風");
const report = result.roundLogs.join("\n");
for (const label of ["西風", "北風", "東風", "南風"]) {
  assert.equal(report.includes(`風向・${label}`), true, `戰報缺少 ${label}`);
}
assert.equal((report.match(/風向・/g) || []).length, 4, "主副手同時裝備不可重複觸發風向");

console.log("胡桃武器風向輪轉、跨場步進與私測可見性驗證通過。");
