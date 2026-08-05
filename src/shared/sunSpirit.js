"use strict";
/**
 * 日之精靈（聖靈師・治療師二轉）——跨場持久化。
 *
 * 規則（使用者定案 2026-07-23）：
 *   - 開場自動召喚，**代替主人承受怪物攻擊**（精靈倒下後主人才會受傷）
 *   - 精靈血量＝主人最大 HP、防禦＝主人 DEF（不繼承閃避與格擋）
 *   - 精靈每回合追加一擊：攻擊力＝主人的 1/3、自帶日屬性 3 級（單發、不爆擊、不連擊）
 *   - 精靈在場時：聖靈師給隊伍的光環效果 ×2（以「出戰當下精靈是否在場」判定）
 *   - 大治療術：每 5 個有出手的回合施放一次，回復最大 HP 的 30%——精靈在場先回精靈，否則回自己
 *   - **血量跨場沿用**（同區；換區/10 分鐘沒打 → 滿血重召）
 *   - **陣亡懲罰**：精靈倒下 → 下一場自動重新召喚但只有 50% HP（不讓死亡變免費重置）
 *
 * 戰鬥內邏輯在 combatLoop（options.sunSpiritHpPct 進、result.sunSpirit 出），
 * 這個模組只管跨場持久化。存放位置：progress.sunSpirit = { zone, hpPct, updatedAt }
 * （存百分比不存絕對值——主人的最大 HP 會隨裝備變動）
 */

/** 多久沒打重置（滿血重召；與各氣條一致） */
const IDLE_MS = 10 * 60 * 1000;

/** 陣亡後下一場的重召血量 % */
const RESUMMON_PCT = 50;

/** 只有這些徽章有日之精靈 */
const SPIRIT_BADGE_IDS = new Set(["job_spiritmaster_t2_v1"]); // 聖靈師

function hasSpirit(jobEq) {
  if (!jobEq) return false;
  return SPIRIT_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/**
 * 讀出「這一場進場時」的精靈血量 %：
 *   換區/逾時 → 100（滿血重召）；上一場倒下（0）→ RESUMMON_PCT；否則沿用。
 */
function read(progress, zone, now = Date.now()) {
  const s = progress?.sunSpirit;
  if (!s || typeof s !== "object") return 100;
  if (String(s.zone || "") !== String(zone || "")) return 100;   // 換區 → 滿血重召
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 100;      // 逾時 → 滿血重召
  const pct = Math.max(0, Math.min(100, Number(s.hpPct)));
  if (!Number.isFinite(pct)) return 100;
  return pct <= 0 ? RESUMMON_PCT : pct;                          // 倒下 → 半血重召
}

/** 打完一場要存回去的狀態（hpPct = combatLoop 回傳的戰後精靈血量 %；倒下存 0） */
function next(hpPct, zone, now = Date.now()) {
  return {
    zone: String(zone || ""),
    hpPct: Math.max(0, Math.min(100, Number(hpPct) || 0)),
    updatedAt: now,
  };
}

/** 給前端／面板的顯示物件 */
function view(hpPct) {
  const p = Math.max(0, Math.min(100, Number(hpPct) || 0));
  return { hpPct: Math.round(p * 10) / 10, down: p <= 0 };
}

module.exports = {
  IDLE_MS,
  RESUMMON_PCT,
  SPIRIT_BADGE_IDS,
  hasSpirit,
  read,
  next,
  view,
};
