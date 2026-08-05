"use strict";
/**
 * 連擊氣條（影舞者・盜賊二轉）。
 *
 * 規則（使用者定案）：
 *   - 氣條 5 格；**本回合有出現連擊 → +1 格，每回合最多 1 格**
 *     （2026-07-22 使用者定案，與劍鬼氣力同節奏；原規則 1+0.5×(n-1)）
 *   - 五格全滿 → **全部消耗** → 下一回合固定 5 連擊（殘影亂舞）
 *   - 那個固定 5 連擊的回合**不會累氣**，下回合重新開始累
 *   - **同一場域內跨場沿用**（比照區域連段：換區歸零、10 分鐘沒打歸零）
 *   - 主動「影襲」：消耗 5 點**區域連段(COMBO)** → 第一回合固定 7 連擊，且**會累氣**
 *
 * 氣條的「戰鬥中」邏輯在 combatLoop（累氣/滿格觸發/固定連擊都在回合內發生），
 * 這個模組只管「跨場持久化」的規則（存放/換區/逾時）。
 * 存放位置：progress.shadowGauge = { zone, grids, updatedAt }
 */

/** 幾格滿（滿了觸發殘影亂舞） */
const GAUGE_MAX = 5;

/** 滿氣觸發的固定連擊段數 */
const BURST_HITS = 5;

/** 影襲：消耗的區域連段點數 / 第一回合固定連擊段數 */
const RUSH_COMBO_COST = 5;
const RUSH_HITS = 7;

/** 多久沒打歸零（與區域連段一致） */
const IDLE_MS = 10 * 60 * 1000;

/** 只有這些徽章有連擊氣條 */
const GAUGE_BADGE_IDS = new Set(["job_shadowdancer_t2_v1"]); // 影舞者

function hasGauge(jobEq) {
  if (!jobEq) return false;
  return GAUGE_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/**
 * 讀出「現在這一刻」的有效氣量：套用換區與逾時歸零。
 * @returns {number} 0 ~ GAUGE_MAX（小數格：1.5 格是合法值）
 */
function read(progress, zone, now = Date.now()) {
  const s = progress?.shadowGauge;
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
    burstHits: BURST_HITS,
    rushComboCost: RUSH_COMBO_COST,
    rushHits: RUSH_HITS,
  };
}

module.exports = {
  GAUGE_MAX,
  BURST_HITS,
  RUSH_COMBO_COST,
  RUSH_HITS,
  IDLE_MS,
  GAUGE_BADGE_IDS,
  hasGauge,
  read,
  next,
  view,
};
