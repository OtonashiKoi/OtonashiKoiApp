"use strict";

const PK_ARENA_BRACKETS = [
  { index: 0, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 1, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 2, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 3, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 4, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 5, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
  { index: 6, key: "S", label: "Lv.40", minLevel: 40, maxLevel: null, stoneCount: 2, stoneDropRate: 0.5 },
];

// Rating 系統：Elo-based，初始 1500，依勝敗和等級差動態調整 K
const PK_RATING_DEFAULT = 1500;
const PK_RATING_MIN = 100;

function calcRatingChange(myRating, opRating, didWin) {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opRating - myRating) / 400));
  const score = didWin ? 1 : 0;
  return Math.round(K * (score - expected));
}

// BOSS 傷害加成：依 rating 區間
function getBossBoostPct(rating) {
  if (rating >= 1800) return 7;
  if (rating >= 1600) return 5;
  if (rating >= 1400) return 3;
  return 0;
}

// 掉落率加成：依 rating 區間（%）
function getDropBoostPct(rating) {
  if (rating >= 1800) return 5;
  if (rating >= 1600) return 3;
  if (rating >= 1400) return 1;
  return 0;
}

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
  PK_RATING_DEFAULT,
  PK_RATING_MIN,
  calcRatingChange,
  getBossBoostPct,
  getDropBoostPct,
};
