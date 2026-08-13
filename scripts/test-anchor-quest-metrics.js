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

function spiritEquipment({ saint = false } = {}) {
  const equipped = {
    job_eq: { itemId: "job_spiritmaster_t2_v1", itemName: "聖靈師徽章", jobSkills: [] },
  };
  if (saint) {
    equipped.anchor = {
      itemId: "s-legend-saint",
      passiveEffects: [{ key: "heal_to_damage", trigger: "passive", target: "self", chance: 100, params: { mult: 7 } }],
    };
  }
  return equipped;
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
  const convertedHealingReport = convertedHealing.roundLogs.join("\n");
  assert(convertedHealingReport.includes("治療光環：每回合名目治療 250 HP"), "聖者開場仍須顯示轉換前的名目治療量");
  assert(!convertedHealingReport.includes("聖者：回血化為傷害（本回合"), "開場光環不可用轉換後傷害蓋掉原始治療資訊");

  const scaledAuraDisplay = battle({
    startPlayerHp: 1000,
    equipped: equippedPassive("heal_to_damage", { mult: 7 }),
    partyEffects: [{
      key: "heal_over_time",
      params: { mode: "pct", value: 8, supportAuraBaseValue: 6, supportAuraStat: "int" },
      sourceName: "DKR（復健模式）",
      sourceJobName: "聖靈師徽章",
      isSelfAura: true,
    }],
  });
  const scaledAuraReport = scaledAuraDisplay.roundLogs.join("\n");
  assert(scaledAuraReport.includes("治療光環 8%（基礎 6%＋INT 補正 2%；每回合名目治療 80 HP）"), "光環說明須拆開基礎比例、INT 補正與轉換前治療量");
  assert(scaledAuraReport.includes("聖者・回血化刃"), "轉換後的實際傷害仍須在獨立傷害事件顯示");
  assert(!scaledAuraReport.includes("聖者：回血化為傷害（本回合"), "光環摘要不可重複顯示轉換後傷害");

  const saintFullHp = battle({
    maxRounds: 3,
    startPlayerHp: 1000,
    equipped: equippedPassive("heal_to_damage", { mult: 7 }),
    partyEffects: [{ key: "heal_over_time", params: { mode: "pct", value: 3 }, sourceName: "自己", isSelfAura: true }],
  });
  const saintFullHpLines = saintFullHp.roundLogs.flatMap((entry) => entry.split("\n")).filter((line) => line.includes("聖者・回血化刃"));
  assert(saintFullHp.finalPlayerHp <= 1000, "滿血聖者不可因轉傷而增加自身 HP");
  assert.strictEqual(saintFullHp.healDone, 0, "滿血聖者轉傷不可記為實際治療");
  assert.strictEqual(saintFullHpLines.length, 3, "滿血聖者仍須每回合按名目治療量轉傷");
  assert(saintFullHpLines.every((line) => line.includes("造成 **105** 點傷害")), "無防木樁上，滿血聖者應將名目治療量 ×7 後再減半");

  // 治療 30 ×7＝210 原始傷害，正常扣 flat DEF 10、吃 50% DEF＝100，再減半＝50。
  const originalRandomForDefense = Math.random;
  Math.random = () => 0.5;
  let defendedConversion;
  try {
    defendedConversion = runCombatLoop(
      { ...PLAYER },
      { ...MONSTER, maxHp: 10000, flatDef: 10, def: 50 },
      "防禦測試木樁",
      10000,
      1,
      {
        equipped: equippedPassive("heal_to_damage", { mult: 7 }),
        partyEffects: [{ key: "heal_over_time", params: { mode: "pct", value: 3 }, sourceName: "自己", isSelfAura: true }],
      },
    );
  } finally {
    Math.random = originalRandomForDefense;
  }
  const defendedLine = defendedConversion.roundLogs.flatMap((entry) => entry.split("\n"))
    .find((line) => line.includes("聖者・回血化刃"));
  assert(defendedLine?.includes("造成 **50** 點傷害"), "回血化刃必須正常吃怪物防禦後再將最終傷害減半");

  const saintExternalOnly = battle({
    maxRounds: 3,
    startPlayerHp: 500,
    equipped: equippedPassive("heal_to_damage", { mult: 7 }),
    partyEffects: [{ key: "heal_over_time", params: { mode: "pct", value: 9 }, sourceName: "隊友", isSelfAura: false }],
  });
  assert(saintExternalOnly.finalPlayerHp <= 500, "聖者不可接受外部治療");
  assert.strictEqual(saintExternalOnly.healDone, 0, "聖者拒絕的外部治療不可記為實際治療");
  assert(!saintExternalOnly.roundLogs.some((entry) => entry.includes("聖者・回血化刃")), "外部治療不可替聖者轉傷");

  const saintOwnAuraSurvivesExternal = battle({
    maxRounds: 3,
    startPlayerHp: 1000,
    equipped: equippedPassive("heal_to_damage", { mult: 7 }),
    partyEffects: [
      { key: "heal_over_time", params: { mode: "pct", value: 9 }, sourceName: "隊友", isSelfAura: false },
      { key: "heal_over_time", params: { mode: "pct", value: 3 }, sourceName: "自己", isSelfAura: true },
    ],
  });
  const ownAuraLines = saintOwnAuraSurvivesExternal.roundLogs.flatMap((entry) => entry.split("\n")).filter((line) => line.includes("聖者・回血化刃"));
  assert.strictEqual(ownAuraLines.length, 3, "外部治療不得在同 key 取最高時蓋掉聖者自己的治療光環");
  assert(ownAuraLines.every((line) => line.includes("造成 **105** 點傷害")), "多人同場時只可轉換聖者自己的名目治療量並於防禦後減半");

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const pureHpSpirit = runCombatLoop(
      { ...PLAYER, agi: 1, def: 95, flatDef: 999, dodge: 95, blockChance: 95 },
      { ...MONSTER, atk: 100, hit: 0 },
      "精靈承傷測試木樁",
      100000,
      1,
      {
        startPlayerHp: 1000,
        skipPlayerAttack: true,
        equipped: spiritEquipment(),
        playerActiveEffects: [
          { key: "damage_reduction", params: { value: 95 } },
          { key: "physical_damage_reduction", params: { value: 95 } },
          { key: "invincible_short", params: { duration: { mode: "turns", value: 1 } }, appliedAt: 1 },
        ],
      },
    );
    assert.strictEqual(pureHpSpirit.finalPlayerHp, 1000, "精靈在場時主人不可承受該次一般攻擊");
    assert(pureHpSpirit.sunSpirit.hpPct < 95, "精靈承傷不可套用主人的 DEF、閃避、格擋、減傷或免傷");

    const saintBigHeal = runCombatLoop(
      { ...PLAYER, atk: 1, agi: 1 },
      { ...MONSTER, maxHp: 1000000, atk: 1, hit: 0 },
      "大治療轉化測試木樁",
      1000000,
      5,
      {
        startPlayerHp: 1000,
        sunSpiritHpPct: 50,
        skipMonsterAttack: true,
        equipped: spiritEquipment({ saint: true }),
      },
    );
    const bigHealConversion = saintBigHeal.roundLogs.flatMap((entry) => entry.split("\n"))
      .find((line) => line.includes("聖者・回血化刃") && line.includes("【大治療術】"));
    assert(bigHealConversion, "聖人錨點下的大治療術必須轉為傷害");
    assert.strictEqual(saintBigHeal.sunSpirit.hpPct, 50, "聖人錨點下的大治療術不可治療精靈");
    assert.strictEqual(saintBigHeal.healDone, 0, "聖人錨點下的大治療術不可回復主人");
  } finally {
    Math.random = originalRandom;
  }

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
