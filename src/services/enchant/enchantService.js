// 附魔服務：記憶體快取設定 + 「發裝時骰附魔」的共用入口。
// 高頻(掉寶)呼叫，故設定用記憶體快取，避免每次打 DB。
const { getConfig, DEFAULTS } = require("./enchantConfig");
const { rollEnchantments } = require("../../shared/enchantEngine");

let cached = null;

async function init() {
  cached = await getConfig().catch(() => null);
  console.log("[Enchant] 設定載入完成");
}
async function refresh() {
  cached = await getConfig().catch(() => cached);
}
function getCachedConfig() {
  return cached || DEFAULTS;
}

const ENCHANTABLE_TIERS = ["D", "C", "B", "A", "S"];

// 主線劇情發的裝備一律不可附魔（劇情道具＝固定數值，不參與附魔玩法）
function isStoryItem(entry) {
  return Boolean(entry && entry.source === "story");
}

/**
 * 若這個背包條目是「可附魔的裝備、且尚未有附魔」→ 就地骰出附魔並寫入 entry.enchantments。
 * 已有 enchantments 的不動（保留玩家既有/交易帶來的）。回傳同一個 entry。
 */
function rollForEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  if (entry.itemType !== "equipment") return entry;              // 只附魔「裝備」
  if (isStoryItem(entry)) return entry;                          // 主線發的裝備不附魔
  if (Array.isArray(entry.enchantments)) return entry;           // 已有就不重骰
  const tier = String(entry.tier || "").toUpperCase();
  if (!ENCHANTABLE_TIERS.includes(tier)) return entry;           // 沒階級不骰
  entry.enchantments = rollEnchantments(tier, getCachedConfig());
  return entry;
}

/**
 * 強制重骰一件裝備的附魔（無視已有附魔）——給「附魔重骰藥水」用。
 * @returns {{ok:boolean, before?:Array, after?:Array, reason?:string}}
 */
function rerollEntryEnchant(entry) {
  if (!entry || entry.itemType !== "equipment") return { ok: false, reason: "not-equipment" };
  if (isStoryItem(entry)) return { ok: false, reason: "story-item" }; // 主線裝備不可附魔
  const tier = String(entry.tier || "").toUpperCase();
  if (!ENCHANTABLE_TIERS.includes(tier)) return { ok: false, reason: "no-tier" };
  const before = Array.isArray(entry.enchantments) ? entry.enchantments : [];
  entry.enchantments = rollEnchantments(tier, getCachedConfig());
  return { ok: true, before, after: entry.enchantments };
}

module.exports = { init, refresh, getCachedConfig, rollForEntry, rerollEntryEnchant };
