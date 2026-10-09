"use strict";
const assert = require("node:assert/strict");
const { SET_DEFS, countEquippedSets, getEquippedSetInfo, getSetEffects, getSetNumericBonuses } = require("../src/shared/equipmentSetBonuses");
const { countEquippedTiers, getEquipmentTierSetBonuses } = require("../src/shared/equipmentTierSetBonuses");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const twoHandTypes = ["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow", "dice"];
for (const type of twoHandTypes) {
  const weapon = { itemId: `test-${type}`, itemName: type, tier: "A", equipSlot: "weapon", weaponType: type, isTwoHanded: false, equipStats: {}, setKey: "northwind_hutao" };
  assert.equal(countEquippedSets({ weapon }).counts.northwind_hutao, 2, `${type} 具名套裝`);
  assert.equal(countEquippedTiers({ weapon }).A, 2, `${type} 階級套裝`);
  assert.deepEqual(getEquippedSetInfo({ weapon })[0].pieces, [`${type}（計2件）`]);
}

for (const key of Object.keys(SET_DEFS)) {
  const weapon = { itemId: `test-${key}`, tier: "A", equipSlot: "weapon", weaponType: "bow", equipStats: {}, setKey: key };
  assert.equal(countEquippedSets({ weapon }).counts[key], 2, `${key} 未計雙手權重`);
}

const twoHand = { itemId: "hutao-wind-sword-2h", tier: "S", equipSlot: "weapon", weaponType: "sword_2h", equipStats: {}, setKey: "northwind_hutao" };
const oneHand = { ...twoHand, itemId: "hutao-wind-sword-1h", weaponType: "sword_1h", isTwoHanded: false };
const armor = Object.fromEntries(["head_top", "head_mid", "head_low", "armor", "garment", "shoes"].map((slot) =>
  [slot, { itemId: `test-${slot}`, tier: "A", equipSlot: slot, equipStats: {}, setKey: "northwind_hutao" }]));
assert.equal(countEquippedSets({ ...armor, weapon: twoHand }).counts.northwind_hutao, 8);
assert.equal(countEquippedSets({ ...armor, weapon: oneHand }).counts.northwind_hutao, 7);
assert.equal(getSetEffects({ ...armor, weapon: twoHand }).filter((effect) => effect.key === "wind_direction_cycle").length, 1);
assert.equal(getSetEffects({ ...armor, weapon: oneHand }).some((effect) => effect.key === "wind_direction_cycle"), false);
assert.equal(getSetNumericBonuses({ weapon: twoHand }).hitPct, 6);
assert.equal(getSetNumericBonuses({ weapon: oneHand }).hitPct, 0);

const threeA = { weapon: { ...twoHand, tier: "A" }, armor: armor.armor };
assert.equal(countEquippedTiers(threeA).A, 3);
assert.equal(getEquipmentTierSetBonuses(threeA).finalDamagePct, 5);
const stats = calcPlayerStats({ str: 30, agi: 30, vit: 30, int: 30, dex: 30, luk: 30 }, threeA);
assert.equal(stats.tierSetBonuses.finalDamagePct, 5, "A 階 3 件應啟動最終傷害 +5%");
assert.equal(stats.tierSetBonuses.hitPct, 6, "胡桃具名 2 件應啟動命中 +6%");

for (const tier of ["D", "C", "B", "A", "S"]) {
  assert.equal(countEquippedTiers({ weapon: { ...twoHand, tier } })[tier], 2);
}
assert.equal(countEquippedSets({ weapon: { ...twoHand, setKeys: ["northwind_hutao", "island_turtle"] } }).counts.island_turtle, 2);
assert.equal(countEquippedTiers({ weapon: oneHand }).S, 1);
const unusualOffhand = { ...twoHand, tier: "A", equipSlot: "shield", isTwoHanded: true };
assert.equal(countEquippedSets({ shield: unusualOffhand }).counts.northwind_hutao, 1);
assert.equal(countEquippedTiers({ shield: unusualOffhand }).A, 1);

const wind = { key: "wind_direction_cycle", target: "self", trigger: "passive", chance: 100,
  params: { eastHit: 10, southFinalDamagePct: 8, westCritDamagePct: 20, northCritRatePct: 15 } };
const target = { level: 1, maxHp: 9999999, atk: 1, def: 0, flatDef: 0, agi: 1, dex: 1,
  luk: 0, int: 1, dodge: 0, hit: 1, critRate: 0, comboChance: 0, blockChance: 0 };
function battle(weapon) {
  const equipped = { ...armor, weapon: { ...weapon, passiveEffects: [wind] } };
  const stats = calcPlayerStats({ str: 40, agi: 30, vit: 40, int: 15, dex: 40, luk: 20 }, equipped);
  const random = Math.random;
  Math.random = () => 0.5;
  try { return runCombatLoop(stats, target, "木樁", target.maxHp, 4,
    { equipped, inventory: [], skipMonsterAttack: true, playerLevel: 50, windDirectionStep: 0 }); }
  finally { Math.random = random; }
}
const twoHandBattle = battle(twoHand), oneHandBattle = battle(oneHand);
const windLabels = result => result.roundLogs.map((line) => line.match(/風向・(東風|南風|西風|北風)/)?.[1]).filter(Boolean);
assert.deepEqual(windLabels(twoHandBattle), ["東風", "東風", "東風", "南風"]);
assert.deepEqual(windLabels(oneHandBattle), ["東風", "南風", "西風", "北風"]);
assert.equal(twoHandBattle.windDirectionRoundsProcessed, 4);
console.log("雙手武器：六種武器、所有具名套裝、D 至 S 階級套裝、舊快照、八件門檻及非雙手邊界通過。");
