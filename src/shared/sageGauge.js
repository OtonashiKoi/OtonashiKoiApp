"use strict";
/**
 * 計謀值（兵聖・軍師二轉）——跨場持久化。
 *
 * 規則（使用者定案 2026-07-23）：
 *   - 3 格；每個有攻擊的回合 +1 格
 *   - 滿 3 格 → **當回合隨機施展一計**（火攻／落石／瞞天過海／連環／破釜沉舟），歸零重積
 *   - 同一場域跨場沿用（換區/10 分鐘沒打歸零）
 *
 * 戰內邏輯在 combatLoop（options.sageGaugeGrids 進、result.sageGauge 出）。
 * 存放位置：progress.sageGauge = { zone, grids, updatedAt }
 */

const GAUGE_MAX = 3;
const IDLE_MS = 10 * 60 * 1000;
const GAUGE_BADGE_IDS = new Set(["job_sage_t2_v1"]); // 兵聖

function hasGauge(jobEq) {
  if (!jobEq) return false;
  return GAUGE_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

function read(progress, zone, now = Date.now()) {
  const s = progress?.sageGauge;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 0;
  return Math.max(0, Math.min(GAUGE_MAX, Number(s.grids) || 0));
}

function next(grids, zone, now = Date.now()) {
  return {
    zone: String(zone || ""),
    grids: Math.max(0, Math.min(GAUGE_MAX, Number(grids) || 0)),
    updatedAt: now,
  };
}

function view(grids) {
  const g = Math.max(0, Math.min(GAUGE_MAX, Number(grids) || 0));
  return { grids: Math.round(g * 10) / 10, max: GAUGE_MAX, full: g >= GAUGE_MAX };
}

module.exports = { GAUGE_MAX, IDLE_MS, GAUGE_BADGE_IDS, hasGauge, read, next, view };
