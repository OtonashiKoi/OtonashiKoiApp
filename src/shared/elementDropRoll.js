"use strict";
/**
 * 「屬性附魔」掉落骰取。
 *
 * 概念：屬性不另外建道具，而是**掉落瞬間附加在該件實例上**（像附魔）。
 *   例：活動區掉到一把「秘銀單手劍」→ 這一把帶 element:"water" / elementLevel:1，
 *       道具庫裡的秘銀單手劍本身完全不動。
 *
 * ── 規則（2026-07-20 定案）──
 *   ‧ **只有期間限定活動區（group:"event"）的怪會掉屬性裝**——屬性裝是活動限定賣點。
 *     火焰區的怪雖然也標了 element(fire)，那只用於「被水剋」，不掉火屬性裝備。
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
 * @param {string} [opts.zone]      掉落來源 zone——**非活動區一律不附**（火焰區標 fire 只為了被剋，不掉火裝）
 * @returns {object} entry
 */
function rollElementForEntry(entry, { element, maxLevel, chancePct = DEFAULT_CHANCE_PCT, minLevel = 1, zone = null } = {}) {
  if (!isEventZone(zone)) return entry;          // 只有活動區掉屬性裝
  const el = normalizeElement(element);
  const maxLv = normalizeElementLevel(maxLevel);
  if (!el || maxLv <= 0) return entry;
  if (!canRollElement(entry)) return entry;

  const chance = Math.min(100, Math.max(0, Number(chancePct) || 0));
  if (Math.random() * 100 >= chance) return entry;

  const lo = Math.max(1, normalizeElementLevel(minLevel) || 1);
  const hi = Math.max(lo, maxLv);
  const level = lo === hi ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));

  entry.element = el;
  entry.elementLevel = level;
  return entry;
}

module.exports = {
  ELEMENT_DROP_SLOTS,
  DEFAULT_CHANCE_PCT,
  canRollElement,
  rollElementForEntry,
};
