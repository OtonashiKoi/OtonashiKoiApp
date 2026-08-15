#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { scaleSupportPartyEffect } = require("../src/shared/supportAuraScaling");

const PROVIDER_EQUIPPED = {
  job_eq: { itemId: "job_sniper_t2_v1", itemName: "神射手徽章" },
  weapon: { itemId: "test-water-bow", elements: { water: 5 } },
  special_1: {
    itemId: "test-fire-hunter-card",
    passiveEffects: [{ key: "bonus_vs_element", trigger: "passive", target: "self", params: { element: "fire", value: 20 } }],
  },
};

const FIGHTER = {
  maxHp: 1000, atk: 10, def: 0, flatDef: 0,
  str: 1, agi: 20, vit: 1, int: 1, dex: 100, luk: 1,
  hit: 100, dodge: 0, crit: 0, combo: 0,
  comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
  weaponType: "sword_1h", finalDamageMultiplier: 1,
};

const MONSTER = {
  maxHp: 999999, atk: 0, def: 0, flatDef: 0,
  str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1,
  hit: 0, dodge: 0, critRate: 0, critDamage: 1.5,
};

function supportEffect(crit = 0, atk = 1000) {
  return scaleSupportPartyEffect(
    { key: "support_shot", target: "party", trigger: "passive", params: { value: 70 } },
    {
      providerStats: { atk, crit, finalDamageMultiplier: 1.2, tierFinalDamageMultiplier: 1.1 },
      equipped: PROVIDER_EQUIPPED,
      inventory: [],
      zone: "test",
    }
  );
}

function battleEffects(effects) {
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    return runCombatLoop({ ...FIGHTER }, { ...MONSTER }, "火屬木樁", MONSTER.maxHp, 1, {
      // 出戰隊友故意拿會被火剋制的金5武器；掩護箭不可借用這個 ×0.5。
      equipped: { weapon: { elements: { metal: 5 } } },
      inventory: [],
      partyEffects: effects,
      monsterElement: "fire",
      monsterElementLevel: 5,
    });
  } finally {
    Math.random = originalRandom;
  }
}

function battle(effect) {
  return battleEffects([
    { ...effect, sourceName: "測試神射手", isSelfAura: false, sourceDiscordId: "sniper" },
  ]);
}

function shotDamages(result) {
  return result.roundLogs
    .flatMap((entry) => entry.split("\n"))
    .map((line) => line.includes("掩護射擊") ? line.match(/造成 \*\*(\d+)\*\* 點傷害/) : null)
    .filter(Boolean)
    .map((matched) => Number(matched[1]));
}

function shotDamage(result) {
  return shotDamages(result)[0] || 0;
}

const normal = battle(supportEffect(0));
assert.strictEqual(shotDamage(normal), 1663, "ATK 70% 掩護箭應套用神射手終傷 1.2×1.1、水5剋火 ×1.5、對火增傷 ×1.2");

const crit = battle(supportEffect(100));
assert.strictEqual(shotDamage(crit), 3326, "掩護箭爆擊應在神射手倍率上再 ×2");

const multipleProviders = battleEffects([
  { ...supportEffect(0, 1000), sourceName: "神射手甲", sourceJobId: "job_sniper_t2_v1", sourceJobName: "神射手", isSelfAura: false, sourceDiscordId: "sniper-a" },
  { ...supportEffect(0, 800), sourceName: "神射手乙", isSelfAura: false, sourceDiscordId: "sniper-b" },
]);
assert.deepStrictEqual(
  shotDamages(multipleProviders).sort((a, b) => a - b),
  [1331, 1663],
  "同區有多名神射手時，每名提供者都應各射一箭"
);
assert.strictEqual(multipleProviders.combatStats.supportShotBySource["sniper-a"], 1663, "甲的箭傷應歸戶給甲");
assert.strictEqual(multipleProviders.combatStats.supportShotBySource["sniper-b"], 1331, "乙的箭傷應歸戶給乙");
assert.deepStrictEqual(
  multipleProviders.combatStats.supportShotBySourceJob["sniper-a"],
  { jobId: "job_sniper_t2_v1", jobName: "神射手", displayName: "神射手甲" },
  "掩護箭必須保留出箭時職業，供賽季 K 按職業歸戶"
);

const duplicateProvider = battleEffects([
  { ...supportEffect(0, 800), sourceName: "神射手甲", isSelfAura: false, sourceDiscordId: "sniper-a" },
  { ...supportEffect(0, 1000), sourceName: "神射手甲", isSelfAura: false, sourceDiscordId: "sniper-a" },
]);
assert.deepStrictEqual(shotDamages(duplicateProvider), [1663], "同一提供者被重複收集時只射一箭，並保留較強快照");
assert.strictEqual(duplicateProvider.combatStats.supportShotBySource["sniper-a"], 1663, "重複提供者不可重複累計貢獻");

console.log("✅ 神射手掩護射擊測試通過：使用提供者倍率、多名神射手各射一箭、同一提供者只結算一次");
