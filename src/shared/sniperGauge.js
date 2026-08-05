"use strict";
/**
 * 震盪值（神射手・弓箭手二轉）——跨場持久化。
 *
 * 規則（使用者定案 2026-07-23）：
 *   - 4 格；每個有攻擊的回合 +1 格（每回合最多 1）
 *   - 滿 4 格 → **當回合立刻施放震盪射擊**：一箭（ATK 100%）＋把對手推遠——
 *     **下回合對手固定攻擊不到你**（而那回合「沒打到你」→ 接神速反擊再補一箭）
 *   - 同一場域跨場沿用（換區/10 分鐘沒打歸零）——尾刀蓄的格不白虧
 *
 * 戰內邏輯在 combatLoop（options.sniperGaugeGrids 進、result.sniperGauge 出），
 * 這個模組只管跨場持久化。存放位置：progress.sniperGauge = { zone, grids, updatedAt }
 */

/** 幾格滿（滿了立刻震盪射擊） */
const GAUGE_MAX = 4;

/** 多久沒打歸零（與各氣條一致） */
const IDLE_MS = 10 * 60 * 1000;

/** 只有這些徽章有震盪值 */
const GAUGE_BADGE_IDS = new Set(["job_sniper_t2_v1"]); // 神射手

function hasGauge(jobEq) {
  if (!jobEq) return false;
  return GAUGE_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/** 讀出「現在這一刻」的有效格數：套用換區與逾時歸零。 */
function read(progress, zone, now = Date.now()) {
  const s = progress?.sniperGauge;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 0;
  return Math.max(0, Math.min(GAUGE_MAX, Number(s.grids) || 0));
}

/** 打完一場要存回去的狀態 */
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
  return { grids: Math.round(g * 10) / 10, max: GAUGE_MAX, full: g >= GAUGE_MAX };
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
