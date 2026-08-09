"use strict";
/**
 * 「屬性附魔」掉落骰取。
 *
 * 概念：屬性不另外建道具，而是**掉落瞬間附加在該件實例上**（像附魔）。
 *   例：活動區掉到一把「秘銀單手劍」→ 這一把帶 element:"water" / elementLevel:1，
 *       道具庫裡的秘銀單手劍本身完全不動。
 *
 * ── 規則（2026-08-09 使用者定案：全區開放，取代 2026-07-20「活動限定」）──
 *   ‧ **所有帶 element 的怪都會掉該屬性的裝備**——怪是什麼屬性，掉的裝就有機率附上。
 *   ‧ 機率依怪物等級階梯：Lv1-9＝5%／10-19＝10%／20-29＝15%／30-39＝20%／40+＝25%；
 *     活動區固定 30%（活動仍是最有效率的屬性農場）。
 *   ‧ 只有「武器側（武器＋副手）」與「防具」會附屬性；飾品(戒指)不附。
 *   ‧ 機率制（預設 30%），不是必得。
 *   ‧ 等級由呼叫端指定上限（活動區小怪最多給水1）。
 *   ‧ 名稱不改，純靠前端屬性徽章顯示。
 *   ‧ 已在玩家手上的舊裝備不補（只有新掉落的才有）。
 */

const { normalizeElement, normalizeElementLevel } = require("./elementSystem");
const { isEventZone } = require("./zones");

/** 會附屬性的槽位：武器側＋防具（飾品 accessory_l/r 刻意排除） */
const ELEMENT_DROP_SLOTS = new Set([
  "weapon", "shield",                                        // 武器側（副手也算，與戰鬥引擎一致）
  "head_top", "head_mid", "head_low", "armor", "garment", "shoes", // 防具
]);

const DEFAULT_CHANCE_PCT = 30;

/**
 * 一般區的附屬機率階梯（2026-08-09 使用者定案：全區開放，怪等級越低機率越低）。
 * 活動區維持 30%（活動仍是最有效率的屬性農場）；活動限定裝 override 100% 不受此表影響。
 * 供給煞車：低區掉 D/C 裝，分解出屬性石率本來就只有 25~35%（ELEMENT_STONE_RATE_BY_TIER）。
 */
function chanceByMonsterLevel(level) {
  const lv = Math.max(1, Number(level) || 1);
  if (lv >= 40) return 25;
  if (lv >= 30) return 20;
  if (lv >= 20) return 15;
  if (lv >= 10) return 10;
  return 5;
}

/** 這件裝備能不能附屬性 */
function canRollElement(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.itemType !== "equipment") return false;
  if (entry.monsterCardOf || entry.monsterCardSkill) return false;   // 怪物卡不附
  if (entry.element) return false;                                   // 已有屬性就不重骰
  return ELEMENT_DROP_SLOTS.has(String(entry.equipSlot || ""));
}

/**
 * 對一件掉落實例骰屬性（原地修改並回傳）。
 * @param {object} entry 背包實例
 * @param {object} opts
 * @param {string} opts.element    要附的屬性（如 "water"）
 * @param {number} opts.maxLevel   等級上限（活動區小怪＝1）
 * @param {number} [opts.chancePct] 附上機率，預設 30
 * @param {number} [opts.minLevel]  等級下限，預設 1
 * @param {string} [opts.zone]         掉落來源 zone——活動區固定 30%，一般區依怪物等級階梯（chanceByMonsterLevel）
 * @param {number} [opts.monsterLevel]  掉落來源怪物等級（一般區算機率用；沒給時退回 DEFAULT_CHANCE_PCT）
 * @param {object} [opts.override]  道具自帶的 elementDrop 設定（活動限定裝），格式同上述參數。
 *   有 override 時**以道具為準並跳過 zone 閘門**——限定裝本身就是活動限定，
 *   而且它也可能從世界王寶箱產出（開箱時沒有 zone 上下文）。
 * @returns {object} entry
 */
function rollElementForEntry(entry, { element, maxLevel, chancePct = null, minLevel = 1, zone = null, monsterLevel = null, override = null } = {}) {
  const cfg = (override && typeof override === "object") ? override : null;
  // 2026-08-09 使用者定案：全區開放——怪是什麼屬性，掉的裝備就有機率附上；
  // 舊制「只有活動區掉」(2026-07-20) 作廢。活動區 30%、一般區依怪物等級階梯。
  const el = normalizeElement(cfg?.element ?? element);
  const maxLv = normalizeElementLevel(cfg?.maxLevel ?? maxLevel);
  if (!el || maxLv <= 0) return entry;
  if (!canRollElement(entry)) return entry;

  const baseChance = cfg?.chancePct ?? chancePct
    ?? (isEventZone(zone) ? DEFAULT_CHANCE_PCT : chanceByMonsterLevel(monsterLevel ?? 1));
  const chance = Math.min(100, Math.max(0, Number(baseChance) || 0));
  if (Math.random() * 100 >= chance) return entry;

  const lo = Math.max(1, normalizeElementLevel(cfg?.minLevel ?? minLevel) || 1);
  const hi = Math.max(lo, maxLv);
  const level = lo === hi ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));

  entry.element = el;
  entry.elementLevel = level;
  return entry;
}

module.exports = {
  ELEMENT_DROP_SLOTS,
  DEFAULT_CHANCE_PCT,
  chanceByMonsterLevel,
  canRollElement,
  rollElementForEntry,
};
