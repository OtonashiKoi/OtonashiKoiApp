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

/** 相剋倍率（作用在玩家造成的傷害上） */
const MULT_ADVANTAGE = 1.3;   // 我方屬性剋制對方
const MULT_DISADVANTAGE = 0.7; // 對方屬性剋制我方
const MULT_NEUTRAL = 1;

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

/** attacker 對 defender 的傷害倍率 */
function getElementMultiplier(attacker, defender) {
  switch (getElementRelation(attacker, defender)) {
    case "advantage": return MULT_ADVANTAGE;
    case "disadvantage": return MULT_DISADVANTAGE;
    default: return MULT_NEUTRAL;
  }
}

/**
 * 從玩家裝備推出「玩家的屬性」。
 * 規則：**武器優先**（你拿什麼屬性的武器打，就是什麼屬性），武器沒屬性才看其他裝備。
 * 其他裝備採「最多件數者勝」，平手時依 ELEMENTS 順序取第一個（結果穩定、不會忽上忽下）。
 * 全部無屬性 → 回 null（不參與相剋）。
 */
function resolvePlayerElement(equipped = {}) {
  if (!equipped || typeof equipped !== "object") return null;

  const weaponElement = normalizeElement(equipped.weapon?.element);
  if (weaponElement) return weaponElement;

  const counts = new Map();
  for (const [slot, item] of Object.entries(equipped)) {
    if (slot === "weapon" || !item) continue;
    const key = normalizeElement(item.element);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return null;

  let best = null;
  let bestCount = 0;
  for (const key of ELEMENTS) {              // 依固定順序走訪 → 平手時結果穩定
    const n = counts.get(key) || 0;
    if (n > bestCount) { best = key; bestCount = n; }
  }
  return best;
}

/** 給戰報用的一行說明（無相剋時回 null，不洗版） */
function describeElementMatchup(attacker, defender) {
  const relation = getElementRelation(attacker, defender);
  if (relation === "neutral") return null;
  const a = getElementLabel(attacker);
  const d = getElementLabel(defender);
  return relation === "advantage"
    ? `🌊 **屬性剋制**！${a} 剋 ${d}，你的傷害提升至 ${Math.round(MULT_ADVANTAGE * 100)}%！`
    : `🛡️ **屬性劣勢**：${d} 剋 ${a}，你的傷害降至 ${Math.round(MULT_DISADVANTAGE * 100)}%。`;
}

module.exports = {
  ELEMENTS,
  ELEMENT_LABELS,
  COUNTERS,
  MULT_ADVANTAGE,
  MULT_DISADVANTAGE,
  MULT_NEUTRAL,
  normalizeElement,
  getElementLabel,
  getElementRelation,
  getElementMultiplier,
  resolvePlayerElement,
  describeElementMatchup,
};
