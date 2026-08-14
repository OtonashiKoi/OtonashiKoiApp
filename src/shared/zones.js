"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Zone 定義表 — 所有怪物區設定的單一來源
// 新增/修改地圖只需改這裡，其他程式碼自動適配
// ─────────────────────────────────────────────────────────────────────────────
const ZONE_DEFS = [
  {
    key:          "beginner",
    featureKey:   "monster_zone_beginner",
    label:        "新手村外的草叢",
    emoji:        "🌱",
    tagline:      "踏出第一步，勇氣萬歲。",
    color:        0x2ecc71,
    minLevel:     1,   // 最低等級（包含）
    maxLevel:     null, // 最高等級（包含），null = 無上限
    defaultEntryFee: 0,
  },
  {
    key:          "normal",
    featureKey:   "monster_zone",
    label:        "起始的草原",
    emoji:        "⚔️",
    tagline:      "新手試煉，準備開打。",
    color:        0xe74c3c,
    minLevel:     1,
    maxLevel:     null,
    defaultEntryFee: 0,
  },
  {
    key:          "mid",
    featureKey:   "monster_zone_mid",
    label:        "陽光草原",
    emoji:        "✦",
    tagline:      "危險上升，獵物更強。",
    color:        0x7c3aed,
    minLevel:     10,
    maxLevel:     25,
    defaultEntryFee: 0,
  },
  {
    key:          "ancient_city",
    featureKey:   "monster_zone_ancient_city",
    label:        "古城",
    emoji:        "🏰",
    tagline:      "千年城牆，邪物棲居。",
    color:        0xf97316,
    minLevel:     25,
    maxLevel:     40,
    defaultEntryFee: 0,
  },
  {
    key:          "ancient_city_deep",
    featureKey:   "monster_zone_ancient_city_deep",
    label:        "古城深處",
    emoji:        "🕯️",
    tagline:      "秘銀礦脈藏於深處；守將與密術，廢都魔王盤踞於此。",
    color:        0xb45309,
    minLevel:     40,
    maxLevel:     null,
    defaultEntryFee: 0,
  },
  {
    key:          "dragon_realm",
    featureKey:   "monster_zone_dragon_realm",
    label:        "龍族之領",
    emoji:        "🐉",
    tagline:      "古龍盤踞之地，龍鱗甲冑由此而出。",
    color:        0x9d174d,
    minLevel:     40,
    maxLevel:     null,
    defaultEntryFee: 0,
  },
  {
    key:          "dragon_king_lair",
    featureKey:   "monster_zone_dragon_king_lair",
    label:        "龍王巢穴",
    emoji:        "👑",
    tagline:      "群龍之主沉眠之地，唯擊敗大史王者方得入內。",
    color:        0x7f1d1d,
    minLevel:     40,
    maxLevel:     null,
    defaultEntryFee: 10000,
  },
  {
    key:          "hellfire",
    featureKey:   "monster_zone_hellfire",
    label:        "地獄火焰",
    emoji:        "🔥",
    tagline:      "烈焰焚盡之地，餘燼裡潛伏著群焰之獸。",
    color:        0xdc2626,
    minLevel:     40,
    maxLevel:     null,
    defaultEntryFee: 12000,
  },
  {
    key:          "hellfire_depths",
    featureKey:   "monster_zone_hellfire_depths",
    label:        "焰獄深處",
    emoji:        "🌋",
    tagline:      "烈焰最深處，狼牙王咆哮於火獄核心；唯屠本週古龍者，方可踏入。",
    color:        0x991b1b,
    minLevel:     40,
    maxLevel:     null,
    defaultEntryFee: 15000,
  },
  {
    key:          "elite",
    featureKey:   "monster_zone_elite",
    label:        "精英區",
    emoji:        "💀",
    tagline:      "極限試煉，非凡之路。",
    color:        0xef4444,
    minLevel:     20,
    maxLevel:     null,
    defaultEntryFee: 5000,
  },
  {
    key:          "nightmare",
    featureKey:   "monster_zone_nightmare",
    label:        "噩夢區",
    emoji:        "🌑",
    tagline:      "黑暗之中，無人生還。",
    color:        0x6d28d9,
    minLevel:     30,
    maxLevel:     null,
    defaultEntryFee: 2000,
  },
  {
    key:          "abyss",
    featureKey:   "monster_zone_abyss",
    label:        "深淵區",
    emoji:        "🕳️",
    tagline:      "深淵回望，你是獵物。",
    color:        0x1e3a5f,
    minLevel:     45,
    maxLevel:     null,
    defaultEntryFee: 8000,
  },
  {
    key:          "mythic",
    featureKey:   "monster_zone_mythic",
    label:        "神話區",
    emoji:        "⚡",
    tagline:      "神話之境，唯強者留名。",
    color:        0xd97706,
    minLevel:     60,
    maxLevel:     null,
    defaultEntryFee: 15000,
  },

  // ── 期間限定活動（空殼 / scaffold）──────────────────────────────────────────
  // group:"event" 的區只出現在戰鬥頁「期間限定活動」分頁，與常態討伐/世界王分開。
  // 目前無怪物、無世界王設定（＝準備中）；之後在後台把怪物 zone 指到這裡、
  // 並另行架設活動世界王內容即可點亮。做法與常態區完全相同。
  {
    key:          "event_1",
    featureKey:   "monster_zone_event_1",
    label:        "限定活動關卡",
    emoji:        "⏳",
    tagline:      "期間限定，內容準備中。",
    color:        0xff9ec4,
    minLevel:     1,
    maxLevel:     null,
    defaultEntryFee: 0,
    group:        "event",
  },
  {
    key:          "event_boss",
    featureKey:   "monster_zone_event_boss",
    label:        "限定活動 世界王",
    emoji:        "🎪",
    tagline:      "期間限定世界王，內容準備中。",
    color:        0xffd166,
    minLevel:     1,
    maxLevel:     null,
    defaultEntryFee: 0,
    group:        "event",
    worldBoss:    true,   // 活動世界王槽位（前端標示用；實際世界王接線於架設內容時再做）
  },
  {
    key:          "event_boss_hutao_preview",
    featureKey:   "monster_zone_event_boss_hutao_preview",
    label:        "VTUBER的世界・胡桃私測",
    emoji:        "🀄",
    tagline:      "北風雀神・胡桃限定武器私測。",
    color:        0x65c9b8,
    minLevel:     1,
    maxLevel:     null,
    defaultEntryFee: 5000,
    group:        "event",
    worldBoss:    true,
    bestiaryVisible: false,
    previewPlayerIds: Object.freeze(["865264891991425055"]),
  },
];

// ─── 快速查詢表 ───────────────────────────────────────────────────────────────
const ALL_ZONE_KEYS          = ZONE_DEFS.map(z => z.key);
const FEATURE_KEY_TO_ZONE    = Object.fromEntries(ZONE_DEFS.map(z => [z.featureKey, z.key]));
const ZONE_TO_FEATURE_KEY    = Object.fromEntries(ZONE_DEFS.map(z => [z.key, z.featureKey]));
const ZONE_BY_KEY            = Object.fromEntries(ZONE_DEFS.map(z => [z.key, z]));
const MONSTER_ZONE_FEATURE_KEYS = new Set(ZONE_DEFS.map(z => z.featureKey));

// ─── 函式 ─────────────────────────────────────────────────────────────────────

/** featureKey → zone key（找不到 fallback "normal"） */
function featureKeyToZone(featureKey) {
  return FEATURE_KEY_TO_ZONE[featureKey] || "normal";
}

/** zone key → featureKey（找不到 fallback "monster_zone"） */
function zoneToFeatureKey(zoneKey) {
  return ZONE_TO_FEATURE_KEY[zoneKey] || "monster_zone";
}

/** 正規化 zone key，非法值 fallback "normal" */
function normalizeZone(zone) {
  return ZONE_BY_KEY[zone] ? zone : "normal";
}

/** 玩家是否可看見／進入指定區域。previewPlayerIds 為空時代表公開。 */
function canPlayerAccessZone(zoneKey, playerId) {
  const def = ZONE_BY_KEY[zoneKey];
  if (!def) return false;
  const allowlist = Array.isArray(def.previewPlayerIds) ? def.previewPlayerIds : [];
  if (allowlist.length === 0) return true;
  return allowlist.includes(String(playerId || ""));
}

/** 已登入玩家可見的區域；私測區不會出現在其他玩家 API。 */
function getVisibleZoneKeys(playerId) {
  return ALL_ZONE_KEYS.filter((zoneKey) => canPlayerAccessZone(zoneKey, playerId));
}

/** 未登入 viewer 只能取得公開區域。 */
function getPublicZoneKeys() {
  return ALL_ZONE_KEYS.filter((zoneKey) => {
    const ids = ZONE_BY_KEY[zoneKey]?.previewPlayerIds;
    return !Array.isArray(ids) || ids.length === 0;
  });
}

/** 是否列入玩家怪物圖鑑；私測／未公開區可保留戰鬥入口但不洩漏圖鑑分類。 */
function isZoneVisibleInBestiary(zoneKey) {
  return ZONE_BY_KEY[zoneKey]?.bestiaryVisible !== false;
}

/** 判斷是否為怪物區的 featureKey */
function isMonsterZoneFeatureKey(featureKey) {
  return MONSTER_ZONE_FEATURE_KEYS.has(featureKey);
}

/** 取得 zone 的顯示主題 */
function getZoneTheme(zoneKey) {
  const def = ZONE_BY_KEY[zoneKey] || ZONE_BY_KEY["normal"];
  return { label: def.label, color: def.color, emoji: def.emoji, tagline: def.tagline };
}

function getZoneDefaultEntryFee(zoneKey) {
  const def = ZONE_BY_KEY[zoneKey] || ZONE_BY_KEY["normal"];
  return Math.max(0, Number(def.defaultEntryFee || 0));
}

/**
 * 檢查玩家等級是否符合進入條件
 * @returns {null|string} null 表示可進入，否則回傳錯誤訊息
 */
function checkZoneLevelRequirement(zoneKey, playerLevel) {
  const def = ZONE_BY_KEY[zoneKey];
  if (!def) return null;

  if (def.minLevel > 1 && playerLevel < def.minLevel) {
    return `**${def.label}** 需要 **Lv.${def.minLevel}** 以上才能進入！（目前：Lv.${playerLevel}）`;
  }
  if (def.maxLevel !== null && playerLevel > def.maxLevel) {
    return `**${def.label}** 僅限 **Lv.${def.maxLevel}** 以下的玩家進入！（目前：Lv.${playerLevel}）`;
  }
  return null;
}

/**
 * 同 checkZoneLevelRequirement，但 binding 物件中的 minLevel/maxLevel 可覆蓋靜態預設
 * @param {string} zoneKey
 * @param {number} playerLevel
 * @param {object|null} binding - channel layout binding（含 minLevel/maxLevel，null 表示未設定）
 * @returns {null|string}
 */
function checkZoneLevelRequirementWithBinding(zoneKey, playerLevel, binding) {
  const def = ZONE_BY_KEY[zoneKey] || {};
  const label = def.label || zoneKey;

  // binding 有明確設定（非 null）才覆蓋；null 表示「不限」，undefined 表示「未填，用預設」
  const minLevel = (binding && binding.minLevel != null) ? binding.minLevel : (def.minLevel ?? 1);
  const maxLevel = (binding && binding.maxLevel !== undefined) ? binding.maxLevel : (def.maxLevel ?? null);

  if (minLevel > 1 && playerLevel < minLevel) {
    return `**${label}** 需要 **Lv.${minLevel}** 以上才能進入！（目前：Lv.${playerLevel}）`;
  }
  if (maxLevel !== null && playerLevel > maxLevel) {
    return `**${label}** 僅限 **Lv.${maxLevel}** 以下的玩家進入！（目前：Lv.${playerLevel}）`;
  }
  return null;
}

/** zone 分組：預設 "normal"（常態討伐/世界王），"event" = 期間限定活動。 */
function getZoneGroup(zoneKey) {
  const def = ZONE_BY_KEY[zoneKey];
  return (def && def.group) || "normal";
}
/** 是否為期間限定活動區。 */
function isEventZone(zoneKey) {
  return getZoneGroup(zoneKey) === "event";
}

module.exports = {
  ZONE_DEFS,
  ALL_ZONE_KEYS,
  FEATURE_KEY_TO_ZONE,
  ZONE_TO_FEATURE_KEY,
  ZONE_BY_KEY,
  MONSTER_ZONE_FEATURE_KEYS,
  featureKeyToZone,
  zoneToFeatureKey,
  normalizeZone,
  canPlayerAccessZone,
  getVisibleZoneKeys,
  getPublicZoneKeys,
  isZoneVisibleInBestiary,
  isMonsterZoneFeatureKey,
  getZoneTheme,
  getZoneDefaultEntryFee,
  getZoneGroup,
  isEventZone,
  checkZoneLevelRequirement,
  checkZoneLevelRequirementWithBinding,
};
