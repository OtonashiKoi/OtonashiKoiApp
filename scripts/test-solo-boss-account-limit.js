"use strict";

const assert = require("assert");
const { taipeiDateKey, normalizeState, readAccountState } = require("../src/services/worldBoss/soloBossAccountState");
const { takeCharacterSnapshot } = require("../src/services/character/characterService");

const boss = { key: "daishi", zone: "elite", maxHp: 450000, killsPerDay: 3 };
const today = taipeiDateKey();
const fresh = normalizeState({}, boss, today);

function state(killsToday, hp = fresh.worldBossPartsHp) {
  return {
    dateKey: today,
    killsToday,
    worldBossPartsHp: { ...hp },
    worldBossPartsMaxHp: { ...fresh.worldBossPartsMaxHp },
  };
}

// 角色 2 正在使用；頂層是角色 2，角色 1 的舊快照已打滿每日 3 隻。
const merged = readAccountState({
  activeCharacterSlot: 2,
  soloBoss: { daishi: state(0) },
  characterSlots: {
    1: { soloBoss: { daishi: state(3, { ...fresh.worldBossPartsHp, head: 0 }) } },
    // 目前人物的舊快照刻意也放 3；必須忽略，否則會與頂層重複計算。
    2: { soloBoss: { daishi: state(3) } },
  },
}, boss);
assert.equal(merged.needsSave, true);
assert.equal(merged.state.killsToday, 3);
assert.equal(merged.state.worldBossPartsHp.head, 0);

// 一旦有帳號層狀態，它就是唯一來源，不再被人物快照覆蓋。
const authoritative = readAccountState({
  accountSoloBoss: { daishi: state(2) },
  activeCharacterSlot: 1,
  soloBoss: { daishi: state(0) },
  characterSlots: { 2: { soloBoss: { daishi: state(3) } } },
}, boss);
assert.equal(authoritative.needsSave, false);
assert.equal(authoritative.state.killsToday, 2);

// 人物切換快照不得再帶走／換入單人王每日狀態。
const snapshot = takeCharacterSnapshot({
  playerId: "test",
  level: 50,
  soloBoss: { daishi: state(3) },
  accountSoloBoss: { daishi: state(3) },
});
assert.equal(snapshot.level, 50);
assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "soloBoss"), false);
assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "accountSoloBoss"), false);

console.log("✅ 單人王每日次數已按帳號共用，人物切換不會重置或重複計算。");
