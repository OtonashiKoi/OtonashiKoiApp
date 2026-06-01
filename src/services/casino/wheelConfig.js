"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// 命運轉盤設定 — 單一來源
// ─────────────────────────────────────────────────────────────────────────────

const ROUND_DURATION_MS = 60 * 1000;     // 60 秒一輪
const LOCK_BEFORE_END_MS = 5 * 1000;     // 結算前 5 秒鎖盤

// 25 格輪盤（依倍率：×2=12 / ×3=6 / ×5=4 / ×10=2 / ×15=1）
const WHEEL_SLOTS = [
  ...Array(12).fill({ color: "yellow", mult: 2 }),
  ...Array(6).fill({ color: "green",  mult: 3 }),
  ...Array(4).fill({ color: "red",    mult: 5 }),
  ...Array(2).fill({ color: "blue",   mult: 10 }),
  ...Array(1).fill({ color: "purple", mult: 15 }),
];

const COLORS = ["yellow", "green", "red", "blue", "purple"];
const COLOR_META = {
  yellow: { emoji: "🟡", label: "黃", mult: 2 },
  green:  { emoji: "🟢", label: "綠", mult: 3 },
  red:    { emoji: "🔴", label: "紅", mult: 5 },
  blue:   { emoji: "🔵", label: "藍", mult: 10 },
  purple: { emoji: "🟣", label: "紫", mult: 15 },
};

// 押注限制
const BET_MIN = 100;
const BET_MAX = 500_000;
const PAYOUT_CAP = 7_500_000;   // 單注單輪賠付上限（滿注 500,000 × 最高倍 15，完全不砍）

// 下注額 → 解鎖階級 + 抽中道具總機率
//   1–5,000：D ／ 5,001–30,000：C ／ 30,001–100,000：B ／ 100,001–500,000：A
function getBetTier(amount) {
  if (amount >= 100_001) return { rate: 0.20, tier: 3, label: "A 階全解鎖" };
  if (amount >= 30_001)  return { rate: 0.15, tier: 2, label: "解鎖至 B 階" };
  if (amount >= 5_001)   return { rate: 0.12, tier: 1, label: "解鎖至 C 階" };
  if (amount >= BET_MIN) return { rate: 0.08, tier: 0, label: "僅 D 階" };
  return { rate: 0, tier: -1, label: "不可下注" };
}

// 統一掉落池：押中色就抽一次，受下注額階級限制
const DROP_POOL = [
  { key: "stone_D", label: "D 階強化石", kind: "stone",     tier: "D", weight: 400, minBetTier: 0 },
  { key: "stone_C", label: "C 階強化石", kind: "stone",     tier: "C", weight: 200, minBetTier: 1 },
  { key: "stone_B", label: "B 階強化石", kind: "stone",     tier: "B", weight: 60,  minBetTier: 2 },
  { key: "stone_A", label: "A 階強化石", kind: "stone",     tier: "A", weight: 15,  minBetTier: 3 },
  { key: "equip_D", label: "D 階裝備",   kind: "equipment", tier: "D", weight: 200, minBetTier: 0 },
  { key: "equip_C", label: "C 階裝備",   kind: "equipment", tier: "C", weight: 100, minBetTier: 1 },
  { key: "equip_B", label: "B 階裝備",   kind: "equipment", tier: "B", weight: 30,  minBetTier: 2 },
  { key: "equip_A", label: "A 階裝備",   kind: "equipment", tier: "A", weight: 5,   minBetTier: 3 },
  { key: "card_D",  label: "D 階卡片",   kind: "card",      tier: "D", weight: 80,  minBetTier: 0 },
  { key: "card_C",  label: "C 階卡片",   kind: "card",      tier: "C", weight: 30,  minBetTier: 1 },
  { key: "card_B",  label: "B 階卡片",   kind: "card",      tier: "B", weight: 10,  minBetTier: 2 },
  { key: "card_A",  label: "A 階卡片",   kind: "card",      tier: "A", weight: 2,   minBetTier: 3 },
];

// 是否需要全頻道廣播
function isBroadcastWorthy({ color, dropKey }) {
  if (color === "purple") return true;
  if (!dropKey) return false;
  return ["equip_A", "card_A", "stone_A"].includes(dropKey);
}

module.exports = {
  ROUND_DURATION_MS,
  LOCK_BEFORE_END_MS,
  WHEEL_SLOTS,
  COLORS,
  COLOR_META,
  BET_MIN,
  BET_MAX,
  PAYOUT_CAP,
  DROP_POOL,
  getBetTier,
  isBroadcastWorthy,
};
