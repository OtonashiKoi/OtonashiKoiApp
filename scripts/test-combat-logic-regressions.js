#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { runCombatLoop } = require("../src/shared/combatLoop");
const dwarfStunGauge = require("../src/shared/dwarfStunGauge");
const zoneFreezeGauge = require("../src/shared/zoneFreezeGauge");
const { WorldBossService, WORLD_BOSS_ZONES } = require("../src/services/worldBoss/worldBossService");

const PLAYER = {
  maxHp: 1000, atk: 100, def: 0, flatDef: 0,
  str: 10, agi: 10, vit: 10, int: 10, dex: 10, luk: 10,
  hit: 100, dodge: 0, crit: 0, combo: 0,
  comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
  weaponType: "sword_1h",
};

const MONSTER = {
  maxHp: 5000, atk: 100, def: 0, flatDef: 0,
  agi: 10, dex: 10, luk: 10, hit: 100, dodge: 0, critRate: 0,
};

function withFixedRandom(fn, value = 0.5) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

// 三元牌的固定補打也算命中連擊：龍王戰意逐段疊層，後段傷害吃到先前層數。
const dragonTripleEffects = [
  { key: "triple_strike", params: { value: 3 } },
  { key: "stack_on_hit_offense", params: { value: 3, cap: 15 } },
];
const dragonTriple = withFixedRandom(() => runCombatLoop(
  { ...PLAYER, atk: 900, combo: 0 }, { ...MONSTER, maxHp: 100000, atk: 0 }, "三元木樁", 100000, 2,
  { forcePlayerHit: true, skipMonsterAttack: true, playerActiveEffects: dragonTripleEffects }
));
for (const roundLog of dragonTriple.roundLogs.slice(0, 2)) {
  assert.deepStrictEqual(
    [...roundLog.matchAll(/龍王戰意[^\n]*攻擊 \*\*\+(\d+)%/g)].map((match) => Number(match[1])),
    [3, 6, 9], "每回合主擊與兩段三元補打應各疊一次，且下一回合重新累積"
  );
  const tripleDamage = [...roundLog.matchAll(/三元・[發中][^\n]*再造成 \*\*(\d+)\*\*/g)]
    .map((match) => Number(match[1]));
  assert.strictEqual(tripleDamage.length, 2, "三元牌應補打兩段");
  assert(tripleDamage[1] > tripleDamage[0], "後一段三元傷害應吃到新增的戰意層數");
}
const dragonTripleCombo = withFixedRandom(() => runCombatLoop(
  { ...PLAYER, atk: 900, combo: 100 }, { ...MONSTER, maxHp: 100000, atk: 0 }, "連擊木樁", 100000, 1,
  { forcePlayerHit: true, skipMonsterAttack: true, playerActiveEffects: dragonTripleEffects }
));
assert(dragonTripleCombo.roundLogs[0].includes("連擊疊加！攻擊 **+12%**"),
  "三元補打後的一般連擊應從已累積的戰意層數繼續增加");

// 以實際三回合反擊傷害驗證門檻，避免只比對條件文字。
for (const [diff, damage] of [[5, 255], [6, 170], [15, 170], [16, 85]]) {
  const result = withFixedRandom(() => runCombatLoop(
    { ...PLAYER, agi: MONSTER.agi + diff }, { ...MONSTER }, "敏捷門檻木樁", MONSTER.maxHp, 3,
    { skipPlayerAttack: true }
  ));
  assert.strictEqual(result.damageTaken, damage, `AGI 差 ${diff} 的反擊次數應符合 >5／>15 門檻`);
}

function hpGateCard(chance, effect = { key: "atk_up", target: "self", params: { value: 100, ownerHpAbovePct: 50, duration: { mode: "turns", value: 1 } } }) {
  return {
    special_1: {
      itemId: "test-hp-gate-card",
      monsterCardSkill: { key: "test_hp_gate", name: "門檻技能", chance, procEffects: [effect] },
    },
  };
}

const noProc = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0 }, "木樁", MONSTER.maxHp, 1,
  { equipped: hpGateCard(0), skipMonsterAttack: true }
));
const proc = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0 }, "木樁", MONSTER.maxHp, 1,
  { equipped: hpGateCard(100), skipMonsterAttack: true }
));
assert.strictEqual(noProc.totalDamage, 100, "血量門檻卡片 chance=0 不可保證發動");
assert.strictEqual(proc.totalDamage, 200, "血量門檻卡片 chance=100 應在當回合生效且只持續指定回合數");

const aliasProc = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0 }, "木樁", MONSTER.maxHp, 1,
  {
    equipped: hpGateCard(100, {
      key: "proc_stun", target: "enemy", chance: 100,
      params: { ownerHpAbovePct: 50, duration: { mode: "turns", value: 1 } },
    }),
    skipMonsterAttack: true,
  }
));
assert(aliasProc.monsterActiveEffects.some((effect) => effect.key === "stun"), "proc_stun 必須正規化為 stun");

const monsterCard = {
  special_1: {
    itemId: "test-monster-card",
    monsterCardSkill: {
      key: "test_monster_skill", name: "測試雷擊", chance: 100,
      procEffects: [{ key: "lightning", target: "enemy", params: { mode: "flat", value: 100 } }],
    },
  },
};
// AGI 跳過整個怪物主動行動：普攻及傷害技能需同步跳過，BOSS 共用規則。
for (const isWorldBoss of [false, true]) {
  for (const [diff, damage, activations] of [[5, 555, 3], [6, 370, 2], [15, 370, 2], [16, 185, 1]]) {
    const result = withFixedRandom(() => runCombatLoop(
      { ...PLAYER, agi: MONSTER.agi + diff }, { ...MONSTER }, "敏捷技能木樁", MONSTER.maxHp, 3,
      { skipPlayerAttack: true, monsterEquipped: monsterCard, isWorldBoss, monsterIsBoss: isWorldBoss }
    ));
    assert.strictEqual(result.damageTaken, damage, `AGI 差 ${diff} 必須同步抑制普攻和主動技能`);
    assert.strictEqual(result.roundLogs.filter(line => line.includes("測試雷擊")).length, activations,
      `AGI 差 ${diff} 的技能發動次數`);
  }
}

const monsterTurn = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER }, "木樁", MONSTER.maxHp, 1,
  { skipPlayerAttack: true, monsterEquipped: monsterCard }
));
const playerTurn = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER }, "木樁", MONSTER.maxHp, 1,
  { skipMonsterAttack: true, monsterEquipped: monsterCard }
));
assert.strictEqual(monsterTurn.totalDamage, 0, "怪物行動不可觸發玩家攻擊或玩家自傷");
assert.strictEqual(playerTurn.finalPlayerHp, PLAYER.maxHp, "玩家行動不可觸發怪物卡片或怪物攻擊");
assert(playerTurn.totalDamage > 0, "玩家行動仍須正常造成傷害");

const stunnedWorldBoss = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, maxHp: 100000 }, "暗眩中世界王", 100000, 3,
  {
    forcePlayerHit: true,
    monsterIsBoss: true,
    isWorldBoss: true,
    teamStunRounds: 999,
    monsterEquipped: monsterCard,
    worldBossPhase: { phase: 2, lightningEnabled: true, lightningHitChance: 100, lightningDamagePct: 25 },
  }
));
assert.strictEqual(stunnedWorldBoss.damageTaken, 0, "巨神震擊期間世界王階段雷擊不可繞過暈眩造成傷害");
assert(!stunnedWorldBoss.roundLogs.join("\n").includes("施放【雷擊術】"), "巨神震擊期間世界王不可施放階段雷擊");

const lightningOffWorldBoss = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0, maxHp: 100000 }, "無雷擊世界王", 100000, 1,
  {
    forcePlayerHit: true,
    monsterIsBoss: true,
    isWorldBoss: true,
    worldBossPhase: { phase: 3, lightningEnabled: false, lightningHitChance: 100, lightningDamagePct: 25 },
  }
), 0);
assert(!lightningOffWorldBoss.roundLogs.join("\n").includes("施放【雷擊術】"), "未開啟雷擊的三階世界王不可誤繼承雷擊術");

const lightningOnWorldBoss = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0, maxHp: 100000 }, "大史王", 100000, 1,
  {
    forcePlayerHit: true,
    monsterIsBoss: true,
    isWorldBoss: true,
    worldBossPhase: { phase: 2, lightningEnabled: true, lightningHitChance: 100, lightningDamagePct: 25 },
  }
), 0);
assert(lightningOnWorldBoss.roundLogs.join("\n").includes("施放【雷擊術】命中"), "明確開啟雷擊的世界王階段仍須施放雷擊術");

const legacyConfigRepo = {
  async getConfig() {
    return {
      phaseConfig: [
        { phase: 1, hpBelowPercent: 70 },
        { phase: 2, hpBelowPercent: 40 },
        { phase: 3, hpBelowPercent: 0 },
      ],
    };
  },
};

async function verifyWorldBossLightningDefaults() {
  const defaultBoss = new WorldBossService(legacyConfigRepo);
  const otherBossKeys = [...new Set(Object.values(WORLD_BOSS_ZONES))].filter((bossKey) => bossKey !== "default");
  const [defaultConfig, ...otherConfigs] = await Promise.all([
    defaultBoss.getConfig(),
    ...otherBossKeys.map((bossKey) => new WorldBossService(legacyConfigRepo, { bossKey }).getConfig()),
  ]);
  assert.strictEqual(defaultConfig.phaseConfig[0].lightningEnabled, false, "大史王第一階段不可雷擊");
  assert.strictEqual(defaultConfig.phaseConfig[1].lightningEnabled, true, "大史王舊資料須相容原本第二階段雷擊");
  assert.strictEqual(defaultConfig.phaseConfig[2].lightningEnabled, true, "大史王舊資料須相容原本第三階段雷擊");
  otherConfigs.forEach((config, index) => {
    assert(config.phaseConfig.every((phase) => phase.lightningEnabled === false), `${otherBossKeys[index]} 舊資料不可繼承共用雷擊`);
  });
  const missingConfigBoss = new WorldBossService({ async getConfig() { return null; } }, { bossKey: "future_world_boss" });
  const missingConfig = await missingConfigBoss.getConfig();
  assert(missingConfig.phaseConfig.every((phase) => phase.lightningEnabled === false), "未建立設定的新世界王也不可繼承大史王雷擊");

  const explicitConfigRepo = {
    async getConfig() {
      return {
        phaseConfig: [
          { phase: 1, hpBelowPercent: 70, lightningEnabled: false },
          { phase: 2, hpBelowPercent: 40, lightningEnabled: true, lightningHitChance: 35, lightningDamagePct: 18 },
          { phase: 3, hpBelowPercent: 0, lightningEnabled: false },
        ],
      };
    },
  };
  const explicitConfig = await new WorldBossService(explicitConfigRepo, { bossKey: "hellfang_king" }).getConfig();
  assert.strictEqual(explicitConfig.phaseConfig[1].lightningEnabled, true, "非大史王仍可由階段設定明確開啟專屬雷擊");
  assert.strictEqual(explicitConfig.phaseConfig[1].lightningHitChance, 35, "階段雷擊命中率必須保留設定值");
  assert.strictEqual(explicitConfig.phaseConfig[1].lightningDamagePct, 18, "階段雷擊傷害比例必須保留設定值");
}

assert.strictEqual(dwarfStunGauge.DEFAULT_THRESHOLD, 300, "暈眩門檻應為 300");
assert.strictEqual(zoneFreezeGauge.DEFAULT_THRESHOLD, 300, "冰凍門檻應為 300");

const hitRoundProbe = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0, maxHp: 100000 }, "命中回合木樁", 100000, 5,
  { forcePlayerHit: true, skipMonsterAttack: true }
));
assert.strictEqual(hitRoundProbe.combatStats.attackRounds, 5, "命中回合應每回合只累積 1，不受段數影響");

verifyWorldBossLightningDefaults()
  .then(() => console.log("✅ 戰鬥邏輯回歸：卡片機率、效果鍵、世界王雷擊隔離、暈眩行動封鎖、雙控制條 300 與命中回合計數通過"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
