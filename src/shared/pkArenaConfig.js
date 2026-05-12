"use strict";

const PK_ARENA_BRACKETS = [
  { index: 0, key: "D", label: "Lv.1-10", minLevel: 1, maxLevel: 10, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 1, key: "D", label: "Lv.1-10", minLevel: 1, maxLevel: 10, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 2, key: "C", label: "Lv.11-20", minLevel: 11, maxLevel: 20, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 3, key: "C", label: "Lv.11-20", minLevel: 11, maxLevel: 20, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 4, key: "B", label: "Lv.21以上", minLevel: 21, maxLevel: null, stoneCount: 1, stoneDropRate: 0.3 },
  { index: 5, key: "B", label: "Lv.21以上", minLevel: 21, maxLevel: null, stoneCount: 1, stoneDropRate: 0.3 },
  { index: 6, key: "B", label: "Lv.21以上", minLevel: 21, maxLevel: null, stoneCount: 1, stoneDropRate: 0.3 },
];

function getPkArenaBracketByIndex(index = 0) {
  const idx = Math.max(0, Math.min(PK_ARENA_BRACKETS.length - 1, Number(index) || 0));
  return PK_ARENA_BRACKETS[idx] || PK_ARENA_BRACKETS[0];
}

function isLevelInPkArenaBracket(level = 1, bracket = PK_ARENA_BRACKETS[0]) {
  const value = Math.max(1, Number(level) || 1);
  if (!bracket) return false;
  if (value < Number(bracket.minLevel || 1)) return false;
  if (bracket.maxLevel != null && value > Number(bracket.maxLevel)) return false;
  return true;
}

module.exports = {
  ARENA_COUNT: PK_ARENA_BRACKETS.length,
  PK_ARENA_BRACKETS,
  getPkArenaBracketByIndex,
  isLevelInPkArenaBracket,
};
