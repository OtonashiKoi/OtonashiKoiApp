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

/** ── 七屬性抗性（V0.5 生存系統・2026-08-02 使用者定案）──
 * 「火抗火、水抗水」：防具側**同屬性**濃度＝對該屬性怪物攻擊的抗性，**雙向**：
 *   ‧ 濃度 0（沒準備對應屬性裝）→ 承傷加重 penaltyPct
 *   ‧ 每級濃度 −perLevelPct，減免封頂 maxReducePct
 * 無屬性怪不觸發（±0，舊內容完全不受影響）。
 * 與「防具剋制減免」(getElementDamageReduction) 是兩套不同投資，可並存疊乘：
 *   打火王 → 水石走相剋環減免、火石走同屬性抗性。
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
 * 多屬性裝備「打這隻怪要看哪個屬性」的挑選邏輯（單一屬性剋制只會對到一個屬性，
 * 相剋環是一對一映射，不會有兩個屬性同時剋同一隻怪，所以不需要疊加不同屬性）：
 *   例：身上水3火2 → 打火屬性怪，水剋火 → 看水3；打金屬性怪，火剋金 → 看火2。
 * 優先找「我方剋怪」的那個屬性；沒有的話才退而求其次看「怪剋我方」的那個屬性（劣勢）；
 * 兩者都沒有 → 無相剋，回傳空。
 */
function _pickAgainstDefender(totals, defenderElement) {
  const defender = normalizeElement(defenderElement);
  if (!defender || totals.size === 0) return { element: null, level: 0 };

  const advantageElement = ELEMENTS.find((el) => COUNTERS[el] === defender);
  if (advantageElement && totals.get(advantageElement) > 0) {
    return { element: advantageElement, level: normalizeElementLevel(totals.get(advantageElement)) };
  }
  const disadvantageElement = COUNTERS[defender];
  if (disadvantageElement && totals.get(disadvantageElement) > 0) {
    return { element: disadvantageElement, level: normalizeElementLevel(totals.get(disadvantageElement)) };
  }
  return { element: null, level: 0 };
}

/**
 * 玩家「攻擊側」屬性（武器＋副手）：依「這場打的怪」動態挑出身上哪個屬性生效。
 * @param {object} equipped 目前裝備
 * @param {string} defenderElement 這場戰鬥怪物的屬性；沒給就回傳無相剋（不生效）
 * @returns {{ element: string|null, level: number }}
 */
function resolveWeaponElement(equipped = {}, defenderElement = null) {
  if (!equipped || typeof equipped !== "object") return { element: null, level: 0 };
  return _pickAgainstDefender(_aggregateElementsMap(equipped, WEAPON_SLOTS), defenderElement);
}

/**
 * 玩家「防禦側」屬性（防具＋飾品）：依「這場打的怪」動態挑出身上哪個屬性生效。
 * @returns {{ element: string|null, level: number }}
 */
function resolveArmorElement(equipped = {}, defenderElement = null) {
  if (!equipped || typeof equipped !== "object") return { element: null, level: 0 };
  return _pickAgainstDefender(_aggregateElementsMap(equipped, ARMOR_SLOTS), defenderElement);
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
  SAME_ELEMENT_RESIST,
  getSameElementResist,
  normalizeElementLevel,
  getElementDamageReduction,
  resolveWeaponElement,
  resolveArmorElement,
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
