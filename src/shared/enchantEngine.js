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
      effectKey: attr.effectKey || null,
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

/**
 * 把「有 effectKey 的附魔詞條」轉成戰鬥效果實例（餵給效果引擎 applyEffectsToStats）。
 * 基礎屬性(無 effectKey)不在此列——它們另在 calcPlayerStats 直接加進屬性加成。
 * @param {Array} enchantments
 * @returns {Array<{key,params:{value},source}>}
 */
function toEffectInstances(enchantments) {
  const out = [];
  if (!Array.isArray(enchantments)) return out;
  for (const e of enchantments) {
    if (e && e.effectKey) out.push({ key: e.effectKey, params: { value: Number(e.value) || 0 }, source: "enchant" });
  }
  return out;
}

/**
 * 把「整套已裝備」的所有附魔詞條跨件加總成顯示用清單（同 key 合併，保留 label/unit/effectKey）。
 * 屬性類（無 effectKey：力/敏/體/智/技/幸）排前、效果類（有 effectKey：火焰終傷、爆擊…）排後。
 * @param {object} equipment 已 merge 的裝備物件（slot → item）
 * @returns {Array<{key,label,value,unit,isEffect}>}
 */
function summarizeEquippedEnchantments(equipment) {
  const map = new Map();
  const items = equipment && typeof equipment === "object" ? Object.values(equipment) : [];
  for (const item of items) {
    if (!item || !Array.isArray(item.enchantments)) continue;
    for (const e of item.enchantments) {
      if (!e || !e.key) continue;
      const k = String(e.key);
      const cur = map.get(k) || { key: k, label: e.label || k, unit: e.unit || "", effectKey: e.effectKey || null, value: 0 };
      cur.value += Number(e.value) || 0;
      if ((!cur.label || cur.label === k) && e.label) cur.label = e.label;
      if (!cur.unit && e.unit) cur.unit = e.unit;
      if (!cur.effectKey && e.effectKey) cur.effectKey = e.effectKey;
      map.set(k, cur);
    }
  }
  const list = [...map.values()].filter((x) => x.value !== 0);
  list.sort((a, b) => {
    const ae = a.effectKey ? 1 : 0, be = b.effectKey ? 1 : 0;
    if (ae !== be) return ae - be;              // 屬性類在前
    return Math.abs(b.value) - Math.abs(a.value); // 各區內數值大者在前
  });
  return list.map((x) => ({ key: x.key, label: x.label, value: x.value, unit: x.unit || "", isEffect: Boolean(x.effectKey) }));
}

module.exports = { rollEnchantments, rollablePool, sumEnchantStats, toEffectInstances, summarizeEquippedEnchantments, randInt };
