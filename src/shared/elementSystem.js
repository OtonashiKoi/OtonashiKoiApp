"use strict";
/**
 * 屬性相剋系統（土火水木金 + 日月，共 7 種）。
 *
 * ── 設計原則 ──
 * 1. **無屬性(null)不參與相剋**：現有 69 隻怪與 487 件道具都沒有 element 欄位，
 *    一律視為無屬性 → 倍率恆為 1，既有平衡完全不受影響。新內容才逐步標。
 * 2. **攻擊與防禦分流**：武器＋副手走相剋；防具只看怪物同屬抗性，不走相剋環。
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
 *  屬性有「濃度等級」1~5，每級 10%：
 *    攻方剋守方 → 傷害 ×(1 + 攻方等級×0.10)
 *    守方剋攻方 → 傷害 ×(1 − 守方等級×0.10)
 *  無屬性或等級 0 → ×1（現有內容不受影響）
 */
const PCT_PER_LEVEL = 0.10;
// 5：對齊「屬性洞」系統的頂點——S 階武器 5 洞全押同屬性 = 濃度5（+50%/-50%）
const MAX_ELEMENT_LEVEL = 5;
const MULT_NEUTRAL = 1;

/** 屬性洞數：依裝備「階級」決定，不是強化等級。D1/C2/B3/A4/S5。 */
const ELEMENT_SOCKET_COUNT_BY_TIER = { D: 1, C: 2, B: 3, A: 4, S: 5 };

function getElementSocketCapacity(tier) {
  return ELEMENT_SOCKET_COUNT_BY_TIER[String(tier || "").toUpperCase()] || 0;
}

/**
 * 讀出一件裝備實例目前身上的屬性分佈（元素 → 濃度），支援兩種格式：
 *   ‧ 新格式 entry.elements = { water: 3, fire: 2 }（屬性洞系統，多屬性並存）
 *   ‧ 舊格式 entry.element/entry.elementLevel（活動區掉落附魔，單一屬性）
 * 兩者不會同時出現在同一件實例上（洞位系統一旦補洞就會把舊格式併入 elements）。
 */
function resolveElementsMap(entry) {
  const map = Object.create(null);
  if (!entry || typeof entry !== "object") return map;
  if (entry.elements && typeof entry.elements === "object") {
    for (const [key, lv] of Object.entries(entry.elements)) {
      const el = normalizeElement(key);
      const n = Math.floor(Number(lv)) || 0;
      if (el && n > 0) map[el] = (map[el] || 0) + n;
    }
    return map;
  }
  const el = normalizeElement(entry.element);
  if (el) {
    const lv = normalizeElementLevel(entry.elementLevel ?? 1);
    if (lv > 0) map[el] = lv;
  }
  return map;
}

/** 把攻擊屬性等級正規化到 0~5 的整數（0＝沒有屬性強度） */
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
 * @param {number} attackerLevel 攻方屬性濃度；攻方發動克制時使用
 * @param {number} defenderLevel 守方屬性濃度；守方發動克制時使用
 */
function getElementMultiplier(attacker, defender, attackerLevel = 0, defenderLevel = 0) {
  const attackLv = normalizeElementLevel(attackerLevel);
  const defenseLv = normalizeElementLevel(defenderLevel);
  switch (getElementRelation(attacker, defender)) {
    // 誰發動克制，就使用誰的屬性濃度：攻方剋守方看攻方；守方剋攻方看守方。
    case "advantage": return attackLv > 0 ? 1 + attackLv * PCT_PER_LEVEL : MULT_NEUTRAL;
    case "disadvantage": return defenseLv > 0 ? Math.max(0, 1 - defenseLv * PCT_PER_LEVEL) : MULT_NEUTRAL;
    default: return MULT_NEUTRAL;
  }
}

/** ── 七屬性抗性（V0.5 生存系統・2026-08-02 使用者定案）──
 * 「火抗火、水抗水」：防具側**同屬性**濃度＝對該屬性怪物攻擊的抗性，**雙向**：
 *   ‧ 濃度 0（沒準備對應屬性裝）→ 承傷加重 penaltyPct
 *   ‧ 每級濃度 −perLevelPct，減免封頂 maxReducePct
 * 無屬性怪不觸發（±0，舊內容完全不受影響）。
 * 防具不參與相剋環：打火怪只看火屬性防具，水屬性防具不提供額外減傷。
 * ⚠️ 數值是保守初版，實際疼痛度用 balance-survival-matrix 調（機制先上、數字後調）。
 */
const SAME_ELEMENT_RESIST = {
  penaltyPct: 0.15,     // 抗性 0%：承傷 ×1.15
  perLevelPct: 0.05,    // 每級（每顆石）承傷 −5%（3 顆打平懲罰）
  maxReducePct: 0.35,   // 減免封頂 −35%＝滿抗
  fullLevel: 10,        // 滿抗所需濃度：10 級＝抗性 100%（每級＝+10% 抗性值，刻度與攻擊側一致）
};

/**
 * 玩家對「這隻怪的屬性」的同屬性抗性。
 * @param {object} equipped 目前裝備
 * @param {string} monsterElement 怪物屬性；無屬性 → 不觸發（mult 1）
 * @returns {{ level: number, pct: number, mult: number }}
 *   pct  ＝ 抗性值 0~100（每級 +10%，10 級滿；給 UI/戰報顯示用的統一刻度）
 *   mult ＝ 承傷倍率（>1 加重、<1 減輕）
 */
function getSameElementResist(equipped = {}, monsterElement = null) {
  const el = normalizeElement(monsterElement);
  if (!el) return { level: 0, pct: 0, mult: 1 };
  const totals = _aggregateElementsMap(equipped, ARMOR_SLOTS);
  // 抗性濃度不吃 MAX_ELEMENT_LEVEL 封頂（那是相剋用的），自己以 fullLevel 為滿
  const level = Math.min(SAME_ELEMENT_RESIST.fullLevel, Math.max(0, Math.floor(Number(totals.get(el)) || 0)));
  const pct = Math.round((level / SAME_ELEMENT_RESIST.fullLevel) * 100);
  const raw = 1 + SAME_ELEMENT_RESIST.penaltyPct - level * SAME_ELEMENT_RESIST.perLevelPct;
  // 修整浮點殘渣（0.9999…→1），避免「減輕 0%」的廢話提示與 !==1 誤判
  const mult = Math.round(Math.max(1 - SAME_ELEMENT_RESIST.maxReducePct, raw) * 10000) / 10000;
  return { level, pct, mult };
}

/**
 * 首頁／玩家資料用的七屬性即時總覽。所有數值直接沿用戰鬥公式：
 *   ‧ 攻擊＝武器＋副手，同屬性合計後封頂 Lv5；發動剋制時最高 +50%。
 *   ‧ 防禦＝所有防具同屬性合計，0～10 顆＝抗性 0%～100%；承傷 115%～65%。
 * 實際戰鬥仍會再與 DEF、技能、套裝等其他倍率共同計算；這裡只呈現屬性層本身。
 */
function getElementCombatProfile(equipped = {}) {
  const attackTotals = _aggregateElementsMap(equipped, WEAPON_SLOTS);
  const armorTotals = _aggregateElementsMap(equipped, ARMOR_SLOTS);
  const elements = ELEMENTS.map((element) => {
    const attackRawLevel = Math.max(0, Math.floor(Number(attackTotals.get(element)) || 0));
    const attackLevel = normalizeElementLevel(attackRawLevel);
    const attackDeltaPct = Math.round(attackLevel * PCT_PER_LEVEL * 100);
    const resistLevel = Math.min(
      SAME_ELEMENT_RESIST.fullLevel,
      Math.max(0, Math.floor(Number(armorTotals.get(element)) || 0))
    );
    const resistPct = Math.round((resistLevel / SAME_ELEMENT_RESIST.fullLevel) * 100);
    const damageTakenMult = Math.round(Math.max(
      1 - SAME_ELEMENT_RESIST.maxReducePct,
      1 + SAME_ELEMENT_RESIST.penaltyPct - resistLevel * SAME_ELEMENT_RESIST.perLevelPct
    ) * 10000) / 10000;
    const damageTakenPct = Math.round(damageTakenMult * 100);
    return {
      element,
      label: ELEMENT_LABELS[element],
      attackLevel,
      attackRawLevel,
      attackMinDamagePct: 100 - attackDeltaPct,
      attackMaxDamagePct: 100 + attackDeltaPct,
      attackAdvantageBonusPct: attackDeltaPct,
      attackAdvantageDamagePct: 100 + attackDeltaPct,
      resistLevel,
      resistPct,
      damageTakenMult,
      damageTakenPct,
      damageTakenDeltaPct: damageTakenPct - 100,
    };
  });
  return {
    elements,
    attackLimits: {
      minLevel: 0,
      maxLevel: MAX_ELEMENT_LEVEL,
      neutralDamagePct: 100,
      minDamagePct: Math.round((1 - MAX_ELEMENT_LEVEL * PCT_PER_LEVEL) * 100),
      maxDamagePct: Math.round((1 + MAX_ELEMENT_LEVEL * PCT_PER_LEVEL) * 100),
      perLevelPct: Math.round(PCT_PER_LEVEL * 100),
      maxAdvantageBonusPct: Math.round(MAX_ELEMENT_LEVEL * PCT_PER_LEVEL * 100),
      maxDisadvantagePenaltyPct: Math.round(MAX_ELEMENT_LEVEL * PCT_PER_LEVEL * 100),
    },
    resistLimits: {
      minLevel: 0,
      maxLevel: SAME_ELEMENT_RESIST.fullLevel,
      minResistPct: 0,
      maxResistPct: 100,
      unpreparedDamageTakenPct: Math.round((1 + SAME_ELEMENT_RESIST.penaltyPct) * 100),
      neutralDamageTakenPct: 100,
      fullDamageTakenPct: Math.round((1 - SAME_ELEMENT_RESIST.maxReducePct) * 100),
      breakEvenLevel: Math.round(SAME_ELEMENT_RESIST.penaltyPct / SAME_ELEMENT_RESIST.perLevelPct),
      perLevelDamagePct: Math.round(SAME_ELEMENT_RESIST.perLevelPct * 100),
    },
  };
}

/** 裝備槽位分類：武器(攻擊相剋) vs 防具(同屬抗性)。
 *  副手(shield)歸武器側——它是戰鬥用裝備，跟主手一起決定你「打出去」的屬性。
 *  卡片/稱號/職業徽章/錨點等特殊槽不參與屬性濃度（那些走各自的效果系統）。
 */
const WEAPON_SLOTS = ["weapon", "shield"];
const ARMOR_SLOTS = [
  "head_top", "head_mid", "head_low", "armor", "garment", "shoes",
  "accessory_l", "accessory_r",
];
// 可以鑲嵌屬性石的槽位＝戰鬥引擎會讀屬性的所有槽位（武器側＋防具側）。
// 洞數一律由階級決定（D1/C2/B3/A4/S5），掉落時自帶的屬性算已填的洞。
// 特殊槽（卡片 special/稱號/職業徽章/錨點）不在此列，不參與屬性系統。
const ELEMENT_SOCKET_SLOTS = [...WEAPON_SLOTS, ...ARMOR_SLOTS];

/** 同一組槽位裡，各屬性的濃度加總（跨裝備件），回傳 { water: 3, fire: 2, ... } */
function _aggregateElementsMap(equipped, slots) {
  const totals = new Map();
  for (const slot of slots) {
    const item = equipped?.[slot];
    if (!item) continue;
    for (const [el, lv] of Object.entries(resolveElementsMap(item))) {
      totals.set(el, (totals.get(el) || 0) + lv);
    }
  }
  return totals;
}

/**
 * 多屬性裝備「打這隻怪要看哪個屬性」的挑選邏輯：
 *   剋制 > 中性 > 被剋；同關係時取濃度較高者。
 * 例：水5＋火5打水怪時，水為中性、火被剋，因此選水5，傷害維持 100%。
 */
function _pickAgainstDefender(totals, defenderElement) {
  const defender = normalizeElement(defenderElement);
  if (!defender || totals.size === 0) return { element: null, level: 0 };

  const candidates = ELEMENTS
    .map((element) => ({
      element,
      level: normalizeElementLevel(totals.get(element)),
      relation: getElementRelation(element, defender),
    }))
    .filter((row) => row.level > 0);
  const priority = { advantage: 0, neutral: 1, disadvantage: 2 };
  candidates.sort((a, b) => {
    const relationDiff = priority[a.relation] - priority[b.relation];
    return relationDiff || b.level - a.level || ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element);
  });
  return candidates[0] || { element: null, level: 0 };
}

/**
 * 玩家「攻擊側」屬性（武器＋副手）：依「這場打的怪」動態挑出身上哪個屬性生效。
 * @param {object} equipped 目前裝備
 * @param {string} defenderElement 這場戰鬥怪物的屬性；沒給就回傳無相剋（不生效）
 * @param {object|null} extraElements 姿態等額外攻擊屬性（不屬於裝備洞）
 * @returns {{ element: string|null, level: number, relation?: string }}
 */
function resolveWeaponElement(equipped = {}, defenderElement = null, extraElements = null) {
  if (!equipped || typeof equipped !== "object") return { element: null, level: 0 };
  const totals = _aggregateElementsMap(equipped, WEAPON_SLOTS);
  if (extraElements && typeof extraElements === "object") {
    for (const [rawElement, rawLevel] of Object.entries(extraElements)) {
      const element = normalizeElement(rawElement);
      const level = Math.max(0, Math.floor(Number(rawLevel)) || 0);
      if (element && level > 0) totals.set(element, (totals.get(element) || 0) + level);
    }
  }
  return _pickAgainstDefender(totals, defenderElement);
}

/**
 * 舊介面相容：只回屬性字串（攻擊側）。新程式請用 resolveWeaponElement。
 */
function resolvePlayerElement(equipped = {}) {
  return resolveWeaponElement(equipped).element;
}

/** 給戰報用的一行攻擊相剋說明（無相剋時回 null，不洗版）
 * @param {number} attackerLevel 攻方屬性等級（武器＋副手，1~5）
 * @param {number} defenderLevel 守方屬性等級（怪物，1~5）
 */
function describeElementMatchup(attacker, defender, attackerLevel = 0, defenderLevel = 0) {
  const attackLv = normalizeElementLevel(attackerLevel);
  const defenseLv = normalizeElementLevel(defenderLevel);
  const relation = getElementRelation(attacker, defender);
  const a = getElementLabel(attacker);
  const d = getElementLabel(defender);
  const lines = [];
  if (attackLv > 0 && relation === "advantage") {
    lines.push(`🌊 **屬性剋制**！${a}${attackLv} 剋 ${d}，你的傷害提升 ${Math.round(attackLv * PCT_PER_LEVEL * 100)}%！`);
  } else if (defenseLv > 0 && relation === "disadvantage") {
    lines.push(`🛡️ **屬性劣勢**：${d}${defenseLv} 剋 ${a}${attackLv}，你的傷害降低 ${Math.round(defenseLv * PCT_PER_LEVEL * 100)}%。`);
  }
  return lines.length ? lines.join("\n") : null;
}

module.exports = {
  ELEMENTS,
  PCT_PER_LEVEL,
  MAX_ELEMENT_LEVEL,
  SAME_ELEMENT_RESIST,
  getSameElementResist,
  getElementCombatProfile,
  normalizeElementLevel,
  resolveWeaponElement,
  WEAPON_SLOTS,
  ARMOR_SLOTS,
  ELEMENT_SOCKET_SLOTS,
  ELEMENT_LABELS,
  COUNTERS,
  MULT_NEUTRAL,
  normalizeElement,
  getElementLabel,
  getElementRelation,
  getElementMultiplier,
  resolvePlayerElement,
  describeElementMatchup,
  ELEMENT_SOCKET_COUNT_BY_TIER,
  getElementSocketCapacity,
  resolveElementsMap,
};
