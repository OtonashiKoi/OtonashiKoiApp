"use strict";
/**
 * 種子化亂數（mulberry32）——模擬測試的可重現性地基。
 *
 * 為什麼需要：戰鬥模擬同設定跑兩次有 ±5% 變異，調旋鈕時分不清「差異來自旋鈕還是雜訊」
 * （盜靈調參時實際發生過：巧手 1.3→1.6→1.8 掃出非單調曲線，白追半小時）。
 * 種子化後同種子＝位元級相同結果，任何差異 100% 來自被改的設定。
 *
 * 用法（包住一段會用到 Math.random 的程式）：
 *   const { withSeed } = require("./lib/seededRandom");
 *   const result = withSeed(12345, () => sim.single(progress, opts));
 *
 * ⚠️ 只給測試腳本用。線上程式碼永遠不准 patch Math.random。
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字串 → 32bit 種子（讓 "swordsman:heavy:42" 這種 key 能直接當種子） */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 在種子化亂數下執行 fn，結束後無論成敗都還原 Math.random */
function withSeed(seed, fn) {
  const original = Math.random;
  const prng = mulberry32(typeof seed === "string" ? hashSeed(seed) : (seed >>> 0));
  Math.random = prng;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

module.exports = { mulberry32, hashSeed, withSeed };
