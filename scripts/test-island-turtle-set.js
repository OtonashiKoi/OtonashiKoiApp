#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { runPkCombat } = require("../src/shared/pkCombat");
const { collectEquipmentEffects } = require("../src/shared/effectEngine");
const { countEquippedSets, getEquippedSetInfo } = require("../src/shared/equipmentSetBonuses");
const { turtleTidePhase, isTurtleTideTransitionRound } = require("../src/shared/turtleSet");

const SET_KEY = "island_turtle";

function piece(id, slot, tier = "A") {
  return {
    id,
    itemId: id,
    itemName: id,
    itemType: "equipment",
    equipSlot: slot,
    tier,
    equipStats: {},
    setKey: SET_KEY,
    setKeys: [SET_KEY],
    setName: "島島龜王套裝・潮生",
  };
}

const turtleSet = {
  weapon: { ...piece("beach-s-sword", "weapon", "S"), weaponType: "sword_1h" },
  shield: piece("beach-shield", "shield"),
  armor: piece("beach-armor", "armor"),
  garment: piece("beach-garment", "garment"),
};

const PLAYER = {
  maxHp: 1000, hp: 1000, atk: 100, def: 0, flatDef: 0,
  str: 10, agi: 1, vit: 1, int: 0, dex: 10, luk: 0,
  hit: 1000, dodge: 0, crit: 0, critRate: 0, critDamage: 1,
  combo: 0, comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
  weaponType: "sword_1h", finalDamageMultiplier: 1,
  tierDamageMultiplier: 1, tierFinalDamageMultiplier: 1, tierCritDamageMultiplier: 1,
  blockChance: 0, armorBreakChance: 0, stunChance: 0,
};

const MONSTER = {
  maxHp: 100000, atk: 1, def: 0, flatDef: 0,
  str: 1, agi: 1, vit: 1, int: 0, dex: 1, luk: 0,
  hit: 1000, dodge: 0, crit: 0, critRate: 0, critDamage: 1,
  dmgMin: 1, dmgMax: 1,
};

function withFixedRandom(fn) {
  const original = Math.random;
  Math.random = () => 0.5;
  try { return fn(); }
  finally { Math.random = original; }
}

function withoutSetTags(equipped) {
  return Object.fromEntries(Object.entries(equipped).map(([slot, item]) => {
    const clone = { ...item };
    delete clone.setKey;
    delete clone.setKeys;
    delete clone.setName;
    return [slot, clone];
  }));
}

function main() {
  assert.strictEqual(countEquippedSets({ weapon: turtleSet.weapon }).counts[SET_KEY], 1, "S 龜王武器應算 1 件");
  assert.strictEqual(countEquippedSets(turtleSet).counts[SET_KEY], 4, "S 龜王武器加三件海灘裝應算 4 件");

  const info = getEquippedSetInfo(turtleSet).find((entry) => entry.setKey === SET_KEY);
  assert(info, "應顯示龜王套裝資訊");
  assert.deepStrictEqual(info.tiers.map((tier) => tier.active), [true, true, true], "4 件時應開啟 2/3/4 件效果");

  const effects = collectEquipmentEffects(turtleSet, "passive", { equipped: turtleSet, inventory: [] });
  const hpEffect = effects.find((effect) => effect.key === "max_hp_multiplier_up");
  const regenEffect = effects.find((effect) => effect.key === "life_regen");
  const tideEffect = effects.find((effect) => effect.key === "turtle_tide_cycle");
  assert.strictEqual(hpEffect?.params?.value, 8, "2 件應提供 MaxHP +8%");
  assert.strictEqual(regenEffect?.params?.value, 3, "3 件應提供 3% MaxHP 回復");
  assert.strictEqual(regenEffect?.params?.interval, 3, "3 件回復應每 3 回合觸發");
  assert.strictEqual(tideEffect?.params?.phaseRounds, 2, "4 件潮汐每階段應維持 2 回合");

  const onePieceStats = calcPlayerStats({ str: 10, agi: 10, vit: 10, int: 10, dex: 10, luk: 10 }, { weapon: turtleSet.weapon });
  const twoPieceStats = calcPlayerStats(
    { str: 10, agi: 10, vit: 10, int: 10, dex: 10, luk: 10 },
    { weapon: turtleSet.weapon, shield: turtleSet.shield }
  );
  assert.strictEqual(twoPieceStats.maxHp, Math.round(onePieceStats.maxHp * 1.08), "2 件 MaxHP 應精確增加 8%");

  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((round) => turtleTidePhase(round, tideEffect)), [
    "high_tide", "high_tide", "ebb_tide", "ebb_tide", "high_tide", "high_tide",
  ]);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].filter((round) => isTurtleTideTransitionRound(round, tideEffect)), [1, 3, 5]);

  const pve = withFixedRandom(() => runCombatLoop(
    { ...PLAYER }, { ...MONSTER }, "套裝測試木樁", MONSTER.maxHp, 6,
    { equipped: turtleSet, inventory: [], startPlayerHp: 500 }
  ));
  const pveText = pve.roundLogs.join("\n");
  assert(pveText.includes("漲潮") && pveText.includes("受到傷害 **-8%**"), "PvE 應報告漲潮減傷");
  assert(pveText.includes("退潮") && pveText.includes("最終傷害 **+8%**"), "PvE 應報告退潮增傷");
  assert.strictEqual((pveText.match(/持續回復！回復/g) || []).length, 2, "PvE 6 回合應在第 3、6 回合各回復一次");

  const plainGear = withoutSetTags(turtleSet);
  const highTide = withFixedRandom(() => runCombatLoop(
    { ...PLAYER }, { ...MONSTER, atk: 100 }, "漲潮承傷木樁", MONSTER.maxHp, 1,
    { equipped: turtleSet, inventory: [], startPlayerHp: 500, skipPlayerAttack: true }
  ));
  const highTideBaseline = withFixedRandom(() => runCombatLoop(
    { ...PLAYER }, { ...MONSTER, atk: 100 }, "一般承傷木樁", MONSTER.maxHp, 1,
    { equipped: plainGear, inventory: [], startPlayerHp: 500, skipPlayerAttack: true }
  ));
  assert(highTide.finalPlayerHp > highTideBaseline.finalPlayerHp, "漲潮回合應實際降低承受傷害");

  const ebbTide = withFixedRandom(() => runCombatLoop(
    { ...PLAYER }, { ...MONSTER }, "退潮輸出木樁", MONSTER.maxHp, 1,
    { equipped: turtleSet, inventory: [], startRound: 3, skipMonsterAttack: true }
  ));
  const ebbTideBaseline = withFixedRandom(() => runCombatLoop(
    { ...PLAYER }, { ...MONSTER }, "一般輸出木樁", MONSTER.maxHp, 1,
    { equipped: plainGear, inventory: [], startRound: 3, skipMonsterAttack: true }
  ));
  assert(ebbTide.totalDamage > ebbTideBaseline.totalDamage, "退潮回合應實際提高最終傷害");

  const pvp = withFixedRandom(() => runPkCombat(
    { ...PLAYER, maxHp: 5000 }, { equipped: turtleSet, inventory: [] }, "龜王套裝玩家",
    { ...PLAYER, maxHp: 5000 }, { equipped: {}, inventory: [] }, "測試對手",
    4
  ));
  const pvpText = pvp.roundLogs.join("\n");
  assert(pvpText.includes("龜王套裝玩家・漲潮"), "PvP 應報告漲潮階段");
  assert(pvpText.includes("龜王套裝玩家・退潮"), "PvP 應報告退潮階段");

  console.log("✅ 島島龜王套裝 2/3/4 件、S 武器計件、PvE/PvP 潮汐與回血驗證通過");
}

main();
