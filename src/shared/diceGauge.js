"use strict";
/**
 * 命運骰集氣＋手氣正旺（賭神・賭徒二轉）——跨場持久化。
 *
 * 規則（使用者定案 2026-07-24）：
 *   【命運骰】6 格；每個有攻擊的回合 +1；集滿的那一回合改丟 **3 顆骰子**——
 *     第三顆（命運骰）骰出 N ＝ 當回合 N 連擊，每一擊都是「前面兩顆骰子」的傷害；
 *     放完歸零重集。格數同一場域跨場沿用（換區/10 分鐘沒打歸零）。
 *   【手氣正旺】被動：每個攻擊回合看兩顆傷害骰的平均——
 *     平均 > 3 → 手氣 +1 層（每層傷害 +2%，上限 25 層＝+50%）
 *     平均 < 3 → 手氣歸零（降回基礎傷害）
 *     平均 = 3 → 維持不動
 *     **全域跨場**（不綁區域、不吃閒置歸零——只有「平均 < 3」會讓它掉下來，使用者定案）
 *
 * 戰內邏輯在 combatLoop（options.diceGaugeGrids / diceLuckStacks 進、
 * result.diceGauge / diceLuck 出），這個模組只管跨場持久化。
 * 存放位置：progress.diceGauge = { zone, grids, updatedAt }
 *           progress.diceLuck  = { stacks, updatedAt }
 */

/** 幾格滿（滿了那回合丟第三顆命運骰） */
const GAUGE_MAX = 6;

/** 命運骰格數：多久沒打歸零（與各氣條一致） */
const IDLE_MS = 10 * 60 * 1000;

/** 手氣正旺：每層傷害 % 與上限層數 */
const LUCK_PER_STACK_PCT = 2;
const LUCK_MAX_STACKS = 25;

/** 只有這些徽章有命運骰／手氣 */
const GAUGE_BADGE_IDS = new Set(["job_dicegod_t2_v1"]); // 賭神

function hasGauge(jobEq) {
  if (!jobEq) return false;
  return GAUGE_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/** 讀命運骰格數（換區/逾時歸零） */
function read(progress, zone, now = Date.now()) {
  const s = progress?.diceGauge;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 0;
  return Math.max(0, Math.min(GAUGE_MAX, Number(s.grids) || 0));
}

/** 打完一場要存回去的格數狀態 */
function next(grids, zone, now = Date.now()) {
  return {
    zone: String(zone || ""),
    grids: Math.max(0, Math.min(GAUGE_MAX, Number(grids) || 0)),
    updatedAt: now,
  };
}

/** 讀手氣層數（全域、不逾時——只有戰內「平均 < 3」會歸零） */
function readLuck(progress) {
  const s = progress?.diceLuck;
  if (!s || typeof s !== "object") return 0;
  return Math.max(0, Math.min(LUCK_MAX_STACKS, Number(s.stacks) || 0));
}

/** 打完一場要存回去的手氣狀態 */
function nextLuck(stacks, now = Date.now()) {
  return {
    stacks: Math.max(0, Math.min(LUCK_MAX_STACKS, Number(stacks) || 0)),
    updatedAt: now,
  };
}

/** 給前端／面板的顯示物件 */
function view(grids, luckStacks = 0) {
  const g = Math.max(0, Math.min(GAUGE_MAX, Number(grids) || 0));
  const st = Math.max(0, Math.min(LUCK_MAX_STACKS, Number(luckStacks) || 0));
  return {
    grids: g, max: GAUGE_MAX, full: g >= GAUGE_MAX,
    luckStacks: st, luckPct: st * LUCK_PER_STACK_PCT, luckMax: LUCK_MAX_STACKS,
  };
}

module.exports = {
  GAUGE_MAX,
  IDLE_MS,
  LUCK_PER_STACK_PCT,
  LUCK_MAX_STACKS,
  GAUGE_BADGE_IDS,
  hasGauge,
  read,
  next,
  readLuck,
  nextLuck,
  view,
};
