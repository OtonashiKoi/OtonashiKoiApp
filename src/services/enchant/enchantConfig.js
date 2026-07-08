// 附魔設定（後台可調）
// doc: enchantConfig / _id:"default"
// 累積制：高階裝備可骰自己這階 + 所有低階的屬性池。
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

// 屬性池分「詞條組(band)」；每個屬性帶數值範圍(min~max)與單位。
// key 盡量對應戰鬥用的 stat key，方便之後套進戰鬥計算。
const DEFAULTS = {
  // 統一數值：基礎屬性 +1~7 點(flat)、衍生詞條 +1~7%(mapped 到效果引擎的 effectKey)
  bands: {
    D: {
      label: "基礎",
      attrs: [
        { key: "str", label: "力量", unit: "", min: 1, max: 7 },
        { key: "agi", label: "敏捷", unit: "", min: 1, max: 7 },
        { key: "vit", label: "體質", unit: "", min: 1, max: 7 },
        { key: "int", label: "智力", unit: "", min: 1, max: 7 },
        { key: "dex", label: "技巧", unit: "", min: 1, max: 7 },
        { key: "luk", label: "幸運", unit: "", min: 1, max: 7 },
        { key: "def", label: "防禦", unit: "%", effectKey: "def_up", min: 1, max: 7 }
      ]
    },
    C: {
      label: "進階",
      attrs: [
        { key: "hit", label: "命中", unit: "%", effectKey: "hit_up", min: 1, max: 7 },
        { key: "dodge", label: "迴避", unit: "%", effectKey: "dodge_up", min: 1, max: 7 },
        { key: "maxHp", label: "最大生命", unit: "%", effectKey: "max_hp_multiplier_up", min: 1, max: 7 }
      ]
    },
    B: {
      label: "強力",
      attrs: [
        { key: "crit", label: "爆擊率", unit: "%", effectKey: "crit_rate_up", min: 1, max: 7 },
        { key: "atk", label: "攻擊力", unit: "%", effectKey: "atk_multiplier_up", min: 1, max: 7 }
      ]
    },
    AS: {
      label: "頂級(A/S 專屬)",
      attrs: [
        { key: "critDmg", label: "爆傷", unit: "%", effectKey: "crit_damage_up", min: 1, max: 7 },
        { key: "multiHit", label: "連擊率", unit: "%", effectKey: "combo_up", min: 1, max: 7 },
        { key: "lifesteal", label: "吸血", unit: "%", effectKey: "lifesteal", min: 1, max: 7 },
        { key: "dmgReduce", label: "傷害減免", unit: "%", effectKey: "damage_reduction", min: 1, max: 7 }
      ]
    }
  },
  // 每個裝備階級可骰幾條附魔
  lineCountByTier: { D: 1, C: 2, B: 2, A: 3, S: 3 },
  // 每個裝備階級可骰「哪些 band」（累積：高階含低階）
  rollableBandsByTier: {
    D: ["D"],
    C: ["D", "C"],
    B: ["D", "C", "B"],
    A: ["D", "C", "B", "AS"],
    S: ["D", "C", "B", "AS"]
  }
};

function deepCloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function mergeConfig(raw) {
  if (!raw || typeof raw !== "object") return deepCloneDefaults();
  return {
    bands: raw.bands && typeof raw.bands === "object" ? raw.bands : deepCloneDefaults().bands,
    lineCountByTier: { ...DEFAULTS.lineCountByTier, ...(raw.lineCountByTier || {}) },
    rollableBandsByTier: { ...DEFAULTS.rollableBandsByTier, ...(raw.rollableBandsByTier || {}) }
  };
}

async function getConfig() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return deepCloneDefaults();
  const doc = await db.collection("enchantConfig").findOne({ _id: "default" }).catch(() => null);
  return mergeConfig(doc);
}

async function saveConfig(patch = {}) {
  const db = await getMongoDb();
  const cur = await getConfig();
  const next = mergeConfig({ ...cur, ...patch });
  await db.collection("enchantConfig").updateOne(
    { _id: "default" },
    { $set: { ...next, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return next;
}

module.exports = { getConfig, saveConfig, DEFAULTS };
