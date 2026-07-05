// 附魔引擎（純邏輯）
// 依裝備階級 + 設定，骰出附魔詞條。累積制：高階可骰自己 + 所有低階 band。
// 附魔存在背包/裝備條目的 enchantments: [{ key, label, value, unit, band }]

function randInt(min, max) {
  const lo = Math.ceil(Number(min) || 0);
  const hi = Math.floor(Number(max) || 0);
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 取某裝備階級可骰的屬性池（攤平 band 內屬性，標上 band）。 */
function rollablePool(tier, config) {
  const bands = (config.rollableBandsByTier && config.rollableBandsByTier[tier]) || [tier];
  const pool = [];
  for (const bandKey of bands) {
    const band = config.bands && config.bands[bandKey];
    if (!band || !Array.isArray(band.attrs)) continue;
    for (const attr of band.attrs) pool.push({ ...attr, band: bandKey });
  }
  return pool;
}

/**
 * 骰出一組附魔。
 * @param {string} tier 裝備階級 D/C/B/A/S
 * @param {object} config enchantConfig.getConfig() 的結果
 * @returns {Array<{key,label,value,unit,band}>}
 */
function rollEnchantments(tier, config) {
  const t = String(tier || "").toUpperCase();
  if (!t || !["D", "C", "B", "A", "S"].includes(t)) return [];
  const lineCount = Math.max(0, Number(config.lineCountByTier?.[t]) || 0);
  if (lineCount <= 0) return [];

  const pool = rollablePool(t, config);
  if (pool.length === 0) return [];

  // 盡量不重複屬性；池不夠才允許重複
  const picks = [];
  const shuffled = shuffle(pool);
  for (let i = 0; i < lineCount; i++) {
    const attr = shuffled[i % shuffled.length];
    picks.push({
      key: attr.key,
      label: attr.label,
      unit: attr.unit || "",
      band: attr.band,
      value: randInt(attr.min, attr.max)
    });
  }
  return picks;
}

/** 把附魔詞條加總成「stat key → 數值」的加成表（給戰鬥/顯示用）。 */
function sumEnchantStats(enchantments) {
  const out = {};
  if (!Array.isArray(enchantments)) return out;
  for (const e of enchantments) {
    if (!e || !e.key) continue;
    out[e.key] = (out[e.key] || 0) + (Number(e.value) || 0);
  }
  return out;
}

module.exports = { rollEnchantments, rollablePool, sumEnchantStats, randInt };
