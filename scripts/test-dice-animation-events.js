#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { runCombatLoop } = require("../src/shared/combatLoop");

const PLAYER = {
  maxHp: 5000, atk: 100, def: 20, flatDef: 0,
  str: 1, agi: 50, vit: 20, int: 1, dex: 100, luk: 50,
  hit: 100, dodge: 0, crit: 0, combo: 0,
  comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
  weaponType: "dice", attackSegments: 2,
  faceMultipliers: [0.5, 0.75, 1, 1, 1.25, 1.5],
  finalDamageMultiplier: 1,
};

const MONSTER = {
  maxHp: 999999, atk: 0, def: 0, flatDef: 0,
  str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1,
  hit: 0, dodge: 0, critRate: 0, critDamage: 1.5,
};

function fixedBattle(options = {}) {
  const originalRandom = Math.random;
  Math.random = () => 0.5; // d6 固定為 4；其他判定也保持可重現。
  try {
    return runCombatLoop({ ...PLAYER }, { ...MONSTER }, "骰面木樁", MONSTER.maxHp, 1, {
      equipped: { weapon: { weaponType: "dice" }, ...(options.equipped || {}) },
      inventory: [],
      ...options,
    });
  } finally {
    Math.random = originalRandom;
  }
}

const gambler = fixedBattle();
assert.equal(gambler.diceEvents.length, 1, "骰子武器每個有效攻擊回合應回傳一筆結構化骰面");
assert.deepEqual(gambler.diceEvents[0], {
  round: 1,
  faces: [4, 4],
  initialFaces: null,
  rerolledIndices: [],
  fateFace: null,
});
assert.match(gambler.roundLogs[0], /擲出 【4】【4】/, "結構化骰面必須與玩家戰報相同");

const diceGod = fixedBattle({
  equipped: {
    weapon: { weaponType: "dice" },
    job_eq: { itemId: "job_dicegod_t2_v1", itemName: "賭神徽章" },
  },
  diceGaugeGrids: 5,
  diceLuckStacks: 0,
});
assert.equal(diceGod.diceEvents.length, 1);
assert.equal(diceGod.diceEvents[0].fateFace, 4, "命運值滿格時第三顆命運骰也必須由後端回傳");
assert.match(diceGod.roundLogs[0], /命運骰.*【4】.*4 連擊/s, "命運骰動畫點數必須與連擊戰報一致");

console.log("✅ 賭徒雙骰與賭神命運骰會回傳和戰報一致的後端結算骰面");
