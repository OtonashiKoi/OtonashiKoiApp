"use strict";
/**
 * 氣力格（劍鬼・劍士二轉）——跨場持久化。
 *
 * 規則（2026-07-22 A 案定案）：
 *   - 氣力 3 格；戰鬥中每回合有攻擊到對手 +1 格（每回合最多 1 格）
 *   - 滿 3 格 → 下一回合**自動施放斬**（倍率 1+0.1×min(連段,30)、無視防禦與等級差、可爆擊）
 *   - **同一場域內跨場沿用**（比照連擊氣條：換區歸零、10 分鐘沒打歸零）——
 *     戰鬥結束時剩餘的氣力（含「已滿待發」）帶去下一場，尾刀不白虧
 *   - 「已滿待發」帶進下一場 → 第 1 回合就自動斬
 *
 * 戰鬥中邏輯在 combatLoop（options.oniGaugeGrids 進、result.oniGauge 出），
 * 這個模組只管跨場持久化。存放位置：progress.oniGauge = { zone, grids, updatedAt }
 */

/** 幾格滿（滿了下回合自動施放斬） */
const GAUGE_MAX = 3;

/** 多久沒打歸零（與區域連段一致） */
const IDLE_MS = 10 * 60 * 1000;

/** 只有這些徽章有氣力格 */
const GAUGE_BADGE_IDS = new Set(["job_swordoni_t2_v1"]); // 劍鬼

function hasGauge(jobEq) {
  if (!jobEq) return false;
  return GAUGE_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/**
 * 讀出「現在這一刻」的有效氣量：套用換區與逾時歸零。
 * @returns {number} 0 ~ GAUGE_MAX（GAUGE_MAX＝已滿待發，下一場第 1 回合就斬）
 */
function read(progress, zone, now = Date.now()) {
  const s = progress?.oniGauge;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;   // 換區
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 0;      // 逾時
  return Math.max(0, Math.min(GAUGE_MAX, Number(s.grids) || 0));
}

/** 打完一場要存回去的狀態（grids = combatLoop 回傳的戰後氣量） */
function next(grids, zone, now = Date.now()) {
  return {
    zone: String(zone || ""),
    grids: Math.max(0, Math.min(GAUGE_MAX, Number(grids) || 0)),
    updatedAt: now,
  };
}

/** 給前端／面板的顯示物件 */
function view(grids) {
  const g = Math.max(0, Math.min(GAUGE_MAX, Number(grids) || 0));
  return {
    grids: Math.round(g * 10) / 10,
    max: GAUGE_MAX,
    full: g >= GAUGE_MAX,
  };
}

module.exports = {
  GAUGE_MAX,
  IDLE_MS,
  GAUGE_BADGE_IDS,
  hasGauge,
  read,
  next,
  view,
};
