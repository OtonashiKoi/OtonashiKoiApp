#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { _recordQuestBattleProgress } = require("../src/bot/handlers/monsterZoneHandlers");

const PLAYER = {
  maxHp: 1000, hp: 1000, atk: 200, def: 10, flatDef: 0,
  str: 20, agi: 20, vit: 10, int: 10, dex: 20, luk: 1,
  hit: 1000, dodge: 0, critRate: 0, critDamage: 1.5,
  combo: 0, comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
  weaponType: "sword_1h", finalDamageMultiplier: 1,
};
const MONSTER = {
  maxHp: 10000, atk: 1, def: 0, flatDef: 0,
  str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1,
  hit: 0, dodge: 0, critRate: 0, critDamage: 1.5,
};

function battle(options) {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    return runCombatLoop({ ...PLAYER }, { ...MONSTER }, "任務測試木樁", MONSTER.maxHp, Number(options?.maxRounds) || 1, {
      equipped: {}, inventory: [], ...options,
    });
  } finally {
    Math.random = originalRandom;
  }
}

function equippedPassive(key, params) {
  return { title_eq: { itemId: `test-${key}`, passiveEffects: [{ key, trigger: "passive", target: "self", chance: 100, params }] } };
}

async function main() {
  const lifestealMissing = battle({
    startPlayerHp: 500,
    playerActiveEffects: [{ key: "lifesteal", params: { value: 20 } }],
  });
  assert.strictEqual(lifestealMissing.healDone, 0, "吸血不可算入聖人治療量");
  assert.strictEqual(lifestealMissing.lifestealDone, 40, "應累計實際吸血量");

  const lifestealFull = battle({
    startPlayerHp: 1000,
    playerActiveEffects: [{ key: "lifesteal", params: { value: 20 } }],
  });
  assert.strictEqual(lifestealFull.lifestealDone, 0, "滿血溢出吸血不可累計");

  const healingMissing = battle({
    startPlayerHp: 900,
    partyEffects: [{ key: "party_heal", params: { mode: "flat", value: 250 }, sourceName: "測試治療", isSelfAura: true }],
  });
  assert.strictEqual(healingMissing.healDone, 100, "治療只可累計實際補回的 HP");
  assert.strictEqual(healingMissing.lifestealDone, 0, "一般治療不可算入吸血量");
  assert(healingMissing.roundLogs.some((line) => line.includes("回合開始・測試治療的治療光環") && line.includes("回復 **100** HP")), "實際治療必須寫在當下結算位置");
  assert(!healingMissing.roundLogs.some((line) => /每回合回復\s+\d+\s+HP/.test(line)), "開場說明不可被前端誤判成實際回血");

  const healingFourRounds = battle({
    maxRounds: 4, startPlayerHp: 500,
    partyEffects: [{ key: "party_heal", params: { mode: "flat", value: 25 }, sourceName: "治療者", isSelfAura: false }],
  });
  const auraHealReports = healingFourRounds.roundLogs.flatMap((entry) => entry.split("\n")).filter((line) => line.includes("回合開始・治療者的治療光環") && line.includes("回復 **"));
  assert.strictEqual(auraHealReports.length, 4, "治療光環每個有實際回血的回合都必須報告");
  assert.strictEqual(healingFourRounds.healDone, 100, "四回合治療光環應累計四次實際治療");

  const healingFull = battle({
    startPlayerHp: 1000,
    partyEffects: [{ key: "party_heal", params: { mode: "flat", value: 250 }, sourceName: "測試治療", isSelfAura: true }],
  });
  assert.strictEqual(healingFull.healDone, 0, "滿血溢補不可累計");
  assert(!healingFull.roundLogs.some((line) => line.includes("回合開始・") && line.includes("治療光環") && line.includes("回復 **")), "滿血時不可報告不存在的治療");

  const convertedHealing = battle({
    startPlayerHp: 900,
    equipped: equippedPassive("heal_to_damage", { mult: 7 }),
    partyEffects: [{ key: "party_heal", params: { mode: "flat", value: 250 }, sourceName: "測試治療", isSelfAura: true }],
  });
  assert.strictEqual(convertedHealing.healDone, 0, "轉成傷害的治療不可累計為實際治療");

  const thirstEquipped = battle({
    startPlayerHp: 500,
    equipped: equippedPassive("heal_immune", {}),
    playerActiveEffects: [{ key: "lifesteal", params: { value: 20 } }],
    partyEffects: [{ key: "party_heal", params: { mode: "flat", value: 250 }, sourceName: "測試治療", isSelfAura: true }],
  });
  assert.strictEqual(thirstEquipped.healDone, 0, "治療免疫時不可累計一般治療");
  assert.strictEqual(thirstEquipped.lifestealDone, 40, "治療免疫不得阻擋實際吸血累計");
  assert(!thirstEquipped.roundLogs.some((line) => line.includes("回合開始・") && line.includes("治療光環") && line.includes("回復 **")), "治療免疫時不可誤報光環回血");

  const recorded = [];
  await _recordQuestBattleProgress(
    { questService: { recordProgress: async (_id, type, amount) => recorded.push([type, amount]) } },
    "test-player", "draw", 200, null, null, null, null, 0, 100, 40,
  );
  assert(recorded.some(([type, amount]) => type === "heal_done" && amount === 100), "DC 戰鬥需送出 heal_done");
  assert(recorded.some(([type, amount]) => type === "lifesteal_done" && amount === 40), "DC 戰鬥需送出 lifesteal_done");

  console.log("✅ 錨點任務判定測試通過：治療與吸血分流，溢補不計");
}

main().catch((error) => { console.error(error); process.exit(1); });
