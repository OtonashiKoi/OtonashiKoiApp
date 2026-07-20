"use strict";
/**
 * 屬性相剋系統（土火水木金 + 日月，共 7 種）。
 *
 * ── 設計原則 ──
 * 1. **無屬性(null)不參與相剋**：現有 69 隻怪與 487 件道具都沒有 element 欄位，
 *    一律視為無屬性 → 倍率恆為 1，既有平衡完全不受影響。新內容才逐步標。
 * 2. **只影響玩家造成的傷害**：剋制 ×1.3、被剋 ×0.7、其餘 ×1。
 *    不另外加成怪物打玩家的傷害——被剋已經是 ×0.7 的劣勢，兩邊都調會變成雙重懲罰。
 * 3. 相剋關係採經典五行環 + 日月對立，玩家不用背表就能直覺理解。
 *
 * ── 相剋環 ──
 *   木 → 土 → 水 → 火 → 金 → 木   （木剋土、土剋水、水剋火、火剋金、金剋木）
 *   日 ⇄ 月                        （互剋）
 */

const ELEMENTS = ["wood", "earth", "water", "fire", "metal", "sun", "moon"];

const ELEMENT_LABELS = {
  wood: "木", earth: "土", water: "水", fire: "火", metal: "金", sun: "日", moon: "月",
};

/** key 剋制 value（五行環 + 日月互剋） */
const COUNTERS = {
  wood: "earth",
  earth: "water",
  water: "fire",
  fire: "metal",
  metal: "wood",
  sun: "moon",
  moon: "sun",
};

/** 相剋倍率（作用在玩家造成的傷害上）
 *  屬性有「濃度等級」1~4，每級 10%：
 *    剋制  → 傷害 ×(1 + 等級×0.10)   水1=1.10 / 水4=1.40
 *    被剋  → 傷害 ×(1 − 等級×0.10)   水1=0.90 / 水4=0.60
 *  無屬性或等級 0 → ×1（現有內容不受影響）
 */
const PCT_PER_LEVEL = 0.10;
const MAX_ELEMENT_LEVEL = 4;
const MULT_NEUTRAL = 1;

/** 把等級正規化到 0~4 的整數（0＝沒有屬性強度） */
function normalizeElementLevel(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_ELEMENT_LEVEL, n);
}

function normalizeElement(value) {
  const key = String(value || "").trim().toLowerCase();
  return ELEMENTS.includes(key) ? key : null;
}

function getElementLabel(value) {
  const key = normalizeElement(value);
  return key ? ELEMENT_LABELS[key] : null;
}

/**
 * attacker 對 defender 的關係。
 * @returns {"advantage"|"disadvantage"|"neutral"}
 */
function getElementRelation(attacker, defender) {
  const a = normalizeElement(attacker);
  const d = normalizeElement(defender);
  if (!a || !d) return "neutral";           // 任一方無屬性 → 不參與相剋
  if (COUNTERS[a] === d) return "advantage";
  if (COUNTERS[d] === a) return "disadvantage";
  return "neutral";
}

/**
 * attacker 對 defender 的傷害倍率。
 * @param {string} attacker 攻方屬性
 * @param {string} defender 守方屬性
 * @param {number} level    攻方的屬性濃度等級 1~4（武器等級）；0/未給 → 不生效
 */
function getElementMultiplier(attacker, defender, level = 0) {
  const lv = normalizeElementLevel(level);
  if (lv <= 0) return MULT_NEUTRAL;              // 沒有濃度 → 不參與相剋
  const pct = lv * PCT_PER_LEVEL;
  switch (getElementRelation(attacker, defender)) {
    case "advantage": return 1 + pct;
    case "disadvantage": return Math.max(0, 1 - pct);
    default: return MULT_NEUTRAL;
  }
}

/**
 * 防具屬性帶來的「受傷減免」比例（0~1，0.4 = 減傷 40%）。
 * 依定案：只有「我方防具屬性剋制該怪屬性」才減免（與攻擊相剋對稱），
 * 同屬性/無關屬性/無屬性一律不減免。
 * @param {string} armorElement 防具屬性
 * @param {string} monsterElement 怪物屬性
 * @param {number} armorLevel 防具屬性總等級（總和封頂 4）
 */
function getElementDamageReduction(armorElement, monsterElement, armorLevel = 0) {
  const lv = normalizeElementLevel(armorLevel);
  if (lv <= 0) return 0;
  return getElementRelation(armorElement, monsterElement) === "advantage" ? lv * PCT_PER_LEVEL : 0;
}

/** 裝備槽位分類：武器(攻擊相剋) vs 防具(受傷減免)。
 *  副手(shield)歸武器側——它是戰鬥用裝備，跟主手一起決定你「打出去」的屬性。
 *  卡片/稱號/職業徽章/錨點等特殊槽不參與屬性濃度（那些走各自的效果系統）。
 */
const WEAPON_SLOTS = ["weapon", "shield"];
const ARMOR_SLOTS = [
  "head_top", "head_mid", "head_low", "armor", "garment", "shoes",
  "accessory_l", "accessory_r",
];

function _readSlot(equipped, slot) {
  const item = equipped?.[slot];
  if (!item) return null;
  const key = normalizeElement(item.element);
  if (!key) return null;
  // 沒寫 elementLevel 的舊資料 → 視為 1 級（有屬性就至少有最低濃度）
  const lv = normalizeElementLevel(item.elementLevel ?? 1);
  return lv > 0 ? { element: key, level: lv } : null;
}

/** 同一組槽位裡，各屬性的等級加總（封頂 4），回傳最強的那個屬性 */
function _aggregate(equipped, slots) {
  const totals = new Map();
  for (const slot of slots) {
    const got = _readSlot(equipped, slot);
    if (!got) continue;
    totals.set(got.element, (totals.get(got.element) || 0) + got.level);
  }
  if (totals.size === 0) return { element: null, level: 0 };
  // 依 ELEMENTS 固定順序走訪 → 等級相同時結果穩定，不會忽上忽下
  let best = null, bestLv = 0;
  for (const key of ELEMENTS) {
    const lv = totals.get(key) || 0;
    if (lv > bestLv) { best = key; bestLv = lv; }
  }
  return { element: best, level: normalizeElementLevel(bestLv) };  // 封頂 4
}

/**
 * 玩家「攻擊側」屬性（武器＋副手）：決定打出去的相剋倍率。
 * @returns {{ element: string|null, level: number }}
 */
function resolveWeaponElement(equipped = {}) {
  if (!equipped || typeof equipped !== "object") return { element: null, level: 0 };
  return _aggregate(equipped, WEAPON_SLOTS);
}

/**
 * 玩家「防禦側」屬性（防具＋飾品）：決定受傷減免。等級總和封頂 4。
 * @returns {{ element: string|null, level: number }}
 */
function resolveArmorElement(equipped = {}) {
  if (!equipped || typeof equipped !== "object") return { element: null, level: 0 };
  return _aggregate(equipped, ARMOR_SLOTS);
}

/**
 * 舊介面相容：只回屬性字串（攻擊側）。新程式請用 resolveWeaponElement。
 */
function resolvePlayerElement(equipped = {}) {
  return resolveWeaponElement(equipped).element;
}

/** 給戰報用的一行說明（無相剋時回 null，不洗版）
 * @param {number} level 攻擊側屬性等級（武器＋副手，1~4）
 * @param {number} drPct 防具減免比例（0~0.4），>0 時附帶說明
 */
function describeElementMatchup(attacker, defender, level = 0, drPct = 0) {
  const lv = normalizeElementLevel(level);
  const relation = getElementRelation(attacker, defender);
  const a = getElementLabel(attacker);
  const d = getElementLabel(defender);
  const lines = [];
  if (lv > 0 && relation === "advantage") {
    lines.push(`🌊 **屬性剋制**！${a}${lv} 剋 ${d}，你的傷害提升 ${Math.round(lv * PCT_PER_LEVEL * 100)}%！`);
  } else if (lv > 0 && relation === "disadvantage") {
    lines.push(`🛡️ **屬性劣勢**：${d} 剋 ${a}${lv}，你的傷害降低 ${Math.round(lv * PCT_PER_LEVEL * 100)}%。`);
  }
  if (drPct > 0) {
    lines.push(`🐚 **屬性護甲**：防具剋制 ${getElementLabel(defender)}，受到的傷害減少 ${Math.round(drPct * 100)}%。`);
  }
  return lines.length ? lines.join("\n") : null;
}

module.exports = {
  ELEMENTS,
  PCT_PER_LEVEL,
  MAX_ELEMENT_LEVEL,
  normalizeElementLevel,
  getElementDamageReduction,
  resolveWeaponElement,
  resolveArmorElement,
  WEAPON_SLOTS,
  ARMOR_SLOTS,
  ELEMENT_LABELS,
  COUNTERS,
  MULT_NEUTRAL,
  normalizeElement,
  getElementLabel,
  getElementRelation,
  getElementMultiplier,
  resolvePlayerElement,
  describeElementMatchup,
};
