#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { runCombatLoop } = require("../src/shared/combatLoop");
const dwarfStunGauge = require("../src/shared/dwarfStunGauge");
const zoneFreezeGauge = require("../src/shared/zoneFreezeGauge");

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
    worldBossPhase: { phase: 2, lightningHitChance: 100, lightningDamagePct: 25 },
  }
));
assert.strictEqual(stunnedWorldBoss.damageTaken, 0, "巨神震擊期間世界王階段雷擊不可繞過暈眩造成傷害");
assert(!stunnedWorldBoss.roundLogs.join("\n").includes("施放【雷擊術】"), "巨神震擊期間世界王不可施放階段雷擊");

assert.strictEqual(dwarfStunGauge.DEFAULT_THRESHOLD, 300, "暈眩門檻應為 300");
assert.strictEqual(zoneFreezeGauge.DEFAULT_THRESHOLD, 300, "冰凍門檻應為 300");

const hitRoundProbe = withFixedRandom(() => runCombatLoop(
  { ...PLAYER }, { ...MONSTER, atk: 0, maxHp: 100000 }, "命中回合木樁", 100000, 5,
  { forcePlayerHit: true, skipMonsterAttack: true }
));
assert.strictEqual(hitRoundProbe.combatStats.attackRounds, 5, "命中回合應每回合只累積 1，不受段數影響");

console.log("✅ 戰鬥邏輯回歸：卡片機率、效果鍵、世界王暈眩行動封鎖、雙控制條 300 與命中回合計數通過");
