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

/**
 * 若這個背包條目是「可附魔的裝備、且尚未有附魔」→ 就地骰出附魔並寫入 entry.enchantments。
 * 已有 enchantments 的不動（保留玩家既有/交易帶來的）。回傳同一個 entry。
 */
function rollForEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  if (entry.itemType !== "equipment") return entry;              // 只附魔「裝備」
  if (Array.isArray(entry.enchantments)) return entry;           // 已有就不重骰
  const tier = String(entry.tier || "").toUpperCase();
  if (!ENCHANTABLE_TIERS.includes(tier)) return entry;           // 沒階級不骰
  entry.enchantments = rollEnchantments(tier, getCachedConfig());
  return entry;
}

module.exports = { init, refresh, getCachedConfig, rollForEntry };
