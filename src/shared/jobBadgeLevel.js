"use strict";
/**
 * 職業徽章 JOB 化 —— 徽章本身有等級與熟練度。
 *
 * 設計（2026-08-03 定案，見 docs/JOB_BADGE_SYSTEM_DESIGN.md）：
 *   ‧ 熟練度：裝著該徽章**出戰一場 +1**。存在背包實例（entry.jobExp）上，
 *     所以換不同徽章各自累積——徽章是資產，不是一次性道具。
 *   ‧ 等級：1~20。每級所需熟練度**遞增**＝ `2 + 目前等級`
 *     （Lv1→2 需 3 場、Lv19→20 需 21 場；練滿 Lv20 共 228 場）。
 *   ‧ 成長的是**徽章的屬性值（equipStats）**——不是效果百分比。
 *     效果（攻擊+50%、暈眩、格擋…）**全程完整生效，不隨等級縮放**。
 *   ‧ 分段給，而且 **Lv20 超過道具庫上的原值**：
 *       Lv1~9 → 50%｜Lv10~19 → 100%（＝道具庫寫的數字）｜Lv20 → 150%
 *     練到 Lv10 才拿到「帳面上」的屬性，Lv20 是超越。
 *   ‧ Lv20 ＝ 解鎖二轉轉職劇情的條件（達成時全服廣播）。
 */

const MAX_JOB_LEVEL = 20;
const TRANSFER_LEVEL = MAX_JOB_LEVEL;   // 達此等級可轉職

/** 從 level 升到 level+1 所需的熟練度（場次） */
function expToNextLevel(level) {
  const l = Math.max(1, Math.min(MAX_JOB_LEVEL, Math.floor(Number(level) || 1)));
  if (l >= MAX_JOB_LEVEL) return Infinity;
  return 2 + l;
}

/** 練到 targetLevel 所需的累計熟練度（Lv1＝0） */
function totalExpForLevel(targetLevel) {
  const t = Math.max(1, Math.min(MAX_JOB_LEVEL, Math.floor(Number(targetLevel) || 1)));
  let sum = 0;
  for (let l = 1; l < t; l++) sum += expToNextLevel(l);
  return sum;
}

/** 累計熟練度 → 等級（1~20） */
function levelFromExp(exp) {
  const e = Math.max(0, Math.floor(Number(exp) || 0));
  let level = 1;
  let spent = 0;
  while (level < MAX_JOB_LEVEL) {
    const need = expToNextLevel(level);
    if (e < spent + need) break;
    spent += need;
    level += 1;
  }
  return level;
}

/** 等級 → 屬性值倍率（分段；Lv20 超越原值） */
function statScaleForLevel(level) {
  const l = Math.max(1, Math.min(MAX_JOB_LEVEL, Math.floor(Number(level) || 1)));
  if (l >= MAX_JOB_LEVEL) return 1.5;   // 滿級：超越帳面值
  if (l >= 10) return 1;                // 中段：等於道具庫寫的數字
  return 0.5;                           // 前段：一半
}

/** 這個背包實例是不是職業徽章 */
function isJobBadgeEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return entry.itemType === "job_badge" || String(entry.equipSlot || "") === "job_eq";
}

/** 徽章實例的目前等級／熟練度概況（給 UI 與判定共用） */
function readBadgeProgress(entry) {
  const exp = Math.max(0, Math.floor(Number(entry?.jobExp) || 0));
  const level = levelFromExp(exp);
  const atMax = level >= MAX_JOB_LEVEL;
  const need = atMax ? 0 : expToNextLevel(level);
  const intoLevel = atMax ? 0 : exp - totalExpForLevel(level);
  return {
    exp,
    level,
    maxLevel: MAX_JOB_LEVEL,
    atMax,
    expIntoLevel: intoLevel,
    expToNext: need,
    scalePct: Math.round(statScaleForLevel(level) * 100),
    canTransfer: level >= TRANSFER_LEVEL,
  };
}

/**
 * 依徽章等級縮放徽章的屬性值（回傳新物件，不動原本的 equipStats）。
 * 取整用四捨五入；原值有給就至少保留 1（避免小數值在低等被抹成 0）。
 */
function scaleStats(equipStats, scale) {
  if (!equipStats || typeof equipStats !== "object") return equipStats;
  const out = {};
  for (const [k, v] of Object.entries(equipStats)) {
    const n = Number(v) || 0;
    if (n === 0) { out[k] = 0; continue; }
    const scaled = Math.round(n * scale);
    out[k] = scaled === 0 ? (n > 0 ? 1 : -1) : scaled;
  }
  return out;
}

/** 徽章實例 → 目前等級對應的屬性值倍率（非徽章一律 1） */
function statScaleForEntry(entry) {
  if (!isJobBadgeEntry(entry)) return 1;
  return statScaleForLevel(levelFromExp(entry.jobExp));
}

/**
 * 徽章實例 → 依等級縮放後的 equipStats（給 calcPlayerStats 用）。
 * 不是徽章、或沒有 equipStats 時原樣回傳。
 */
function effectiveStatsForEntry(entry) {
  if (!isJobBadgeEntry(entry) || !entry.equipStats) return entry?.equipStats || null;
  return scaleStats(entry.equipStats, statScaleForEntry(entry));
}

/**
 * 出戰一場：把熟練度 +1 寫進徽章實例（原地修改）。
 * @returns {{ leveled:boolean, from:number, to:number, atMax:boolean }|null} 沒有徽章時回 null
 */
function gainBattleExp(entry, amount = 1) {
  if (!isJobBadgeEntry(entry)) return null;
  const before = levelFromExp(entry.jobExp);
  if (before >= MAX_JOB_LEVEL) return { leveled: false, from: before, to: before, atMax: true };
  entry.jobExp = Math.max(0, Math.floor(Number(entry.jobExp) || 0)) + Math.max(1, Math.floor(Number(amount) || 1));
  const after = levelFromExp(entry.jobExp);
  return { leveled: after > before, from: before, to: after, atMax: after >= MAX_JOB_LEVEL };
}

module.exports = {
  MAX_JOB_LEVEL,
  TRANSFER_LEVEL,
  expToNextLevel,
  totalExpForLevel,
  levelFromExp,
  statScaleForLevel,
  isJobBadgeEntry,
  readBadgeProgress,
  scaleStats,
  statScaleForEntry,
  effectiveStatsForEntry,
  gainBattleExp,
};
