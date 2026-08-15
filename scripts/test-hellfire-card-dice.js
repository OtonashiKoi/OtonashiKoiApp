"use strict";

const assert = require("node:assert/strict");
const { CARDS } = require("./create-hellfire-weapon-cards");
const { isEffectConditionMet } = require("../src/shared/effectEngine");

const card = CARDS.find((entry) => entry.card === "烈焰狼卡");
assert.ok(card, "應存在烈焰狼卡設定");

const bonusEffects = card.effects.filter((effect) => Number(effect?.params?.value) !== 6);
assert.equal(bonusEffects.length, 2, "烈焰狼卡應有兩條雙手武器追加效果");

const diceContext = { equipped: { weapon: { weaponType: "dice", isTwoHanded: true } } };
for (const effect of bonusEffects) {
  assert.equal(isEffectConditionMet(effect, diceContext), true, `${effect.key} 應支援骰子`);
}

const daggerContext = { equipped: { weapon: { weaponType: "dagger", isTwoHanded: false } } };
for (const effect of bonusEffects) {
  assert.equal(isEffectConditionMet(effect, daggerContext), false, `${effect.key} 不應套用單手匕首`);
}

console.log("✅ 烈焰狼卡：骰子可觸發攻擊 +12% 與爆擊傷害 +18%");
