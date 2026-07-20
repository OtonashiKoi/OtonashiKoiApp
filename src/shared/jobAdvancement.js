"use strict";
/**
 * 二轉（Job Advancement Tier 2）單一來源。
 *
 * 為什麼獨立一個檔：
 *   既有 10 個一轉職業的判定散落在 combatLoop / towerHandlers / supportAuraScaling /
 *   monsterZoneHandlers / playerAppRoutes / jobBadgeBonus 等 6～7 處各自的字串比對表，
 *   新增一個職業要改 7～13 個檔。二轉是全新系統，這裡從一開始就收成單一來源，
 *   之後新增二轉只要動這個檔 + 一支 upsert script。
 *   （既有一轉的散落硬編碼本次刻意不動，避免影響線上。）
 *
 * 二轉通則（使用者定案）：
 *   - 門檻：Lv.35，且必須持有對應的一轉徽章
 *   - 試煉條件：以該一轉職業累積戰鬥次數（metric = battle_as_<baseKey>）
 *   - 一轉徽章不銷毀，二轉後仍可自由換回
 *   - 每位玩家最多持有 3 個二轉徽章
 *   - 同時只能進行 1 條二轉試煉
 *   - 第 1／2／3 個二轉的試煉要求＝出戰 350 ／ 700 ／ 1000 場
 *   - 同一個一轉職業的分支只能選一個（選了劍聖就不能再拿大劍）
 */

/** 二轉門檻等級 */
const T2_LEVEL_REQUIREMENT = 35;

/** 每位玩家最多可持有的二轉徽章數 */
const T2_MAX_OWNED = 3;

/**
 * 第 N 個二轉的試煉要求（index 0 = 第 1 個），單位＝以該一轉職業出戰次數。
 * 越後面的二轉越難拿，逼玩家想清楚順序。
 */
const T2_TRIAL_TARGETS = [350, 700, 1000];

/**
 * 一轉職業：key → { badgeId, name, battleMetric }
 * battleMetric 是「裝備該徽章出戰一場」會累積的任務指標。
 */
const BASE_JOBS = {
  swordsman:     { badgeId: "job_swordsman_v1",     name: "劍士" },
  warrior:       { badgeId: "job_warrior_v1",       name: "戰士" },
  dwarf_warrior: { badgeId: "job_dwarf_warrior_v1", name: "矮人戰士" },
  rogue:         { badgeId: "job_rogue_v1",         name: "盜賊" },
  mage:          { badgeId: "job_mage_v1",          name: "法師" },
  healer:        { badgeId: "job_healer_v1",        name: "治療師" },
  archer:        { badgeId: "job_archer_v1",        name: "弓箭手" },
  tactician:     { badgeId: "job_tactician_v1",     name: "軍師" },
  bard:          { badgeId: "job_bard_v1",          name: "詩人" },
  barrier_mage:  { badgeId: "job_barrier_mage_v1",  name: "結界師" },
  gambler:       { badgeId: "job_gambler_v1",       name: "賭徒" },
};

/** 該一轉職業的「出戰次數」任務指標名稱 */
function battleMetricFor(baseKey) {
  return `battle_as_${baseKey}`;
}

/** 全部一轉職業的出戰指標清單（給 weeklyQuestService 註冊 QUEST_TYPES 用） */
function allBattleMetrics() {
  return Object.keys(BASE_JOBS).map(battleMetricFor);
}

/**
 * 二轉分支表：baseKey → 分支陣列。
 *
 * ⚠️ 目前是空的——地基先蓋好，各職業的二轉內容逐一設計後才填進來。
 * 分支物件格式：
 *   {
 *     id:        "job_swordmaster_t2_v1",   // 徽章 itemId，必須以 job_ 開頭、含 _t2_
 *     key:       "swordmaster",
 *     name:      "劍聖",
 *     theme:     "盾牌格擋反擊",              // 一句話定位，給後台/文件看
 *     towerAura: { key: "party_damage_reduction", value: 8, notes: "爬塔：隊伍受到傷害 -8%" },
 *   }
 */
const T2_BRANCHES = {
  swordsman: [],
  warrior: [],
  dwarf_warrior: [],
  rogue: [],
  mage: [],
  healer: [],
  archer: [],
  tactician: [],
  bard: [],
  barrier_mage: [],
  gambler: [],
};

/** 攤平成 id → { ...branch, baseKey } 的索引 */
const T2_BY_ID = (() => {
  const map = new Map();
  for (const [baseKey, branches] of Object.entries(T2_BRANCHES)) {
    for (const b of branches) {
      if (b && b.id) map.set(String(b.id), { ...b, baseKey });
    }
  }
  return map;
})();

/** 這個 itemId 是不是二轉徽章 */
function isT2BadgeId(itemId) {
  return T2_BY_ID.has(String(itemId || ""));
}

/** 取得二轉分支定義（找不到回 null） */
function getT2Branch(itemId) {
  return T2_BY_ID.get(String(itemId || "")) || null;
}

/** 取得某一轉職業的全部二轉分支 */
function getBranchesForBase(baseKey) {
  return T2_BRANCHES[baseKey] ? [...T2_BRANCHES[baseKey]] : [];
}

/** 一轉徽章 itemId → baseKey（找不到回 null） */
function getBaseKeyByBadgeId(badgeId) {
  const id = String(badgeId || "");
  for (const [key, def] of Object.entries(BASE_JOBS)) {
    if (def.badgeId === id) return key;
  }
  return null;
}

/**
 * 計算玩家已持有的二轉徽章數量。
 * itemIds 可以是 Set 或陣列（背包 + 已裝備都要算，因為一轉徽章不銷毀、可自由換裝）。
 */
function countOwnedT2(itemIds) {
  const ids = itemIds instanceof Set ? itemIds : new Set(Array.isArray(itemIds) ? itemIds : []);
  let n = 0;
  for (const id of ids) {
    if (isT2BadgeId(id)) n += 1;
  }
  return n;
}

/**
 * 第 N 個二轉的試煉要求。ownedCount = 玩家目前已持有的二轉徽章數。
 * 已達上限時回 null（代表不該再顯示新的二轉試煉）。
 */
function trialTargetFor(ownedCount) {
  const n = Math.max(0, Number(ownedCount) || 0);
  if (n >= T2_MAX_OWNED) return null;
  return T2_TRIAL_TARGETS[n] ?? T2_TRIAL_TARGETS[T2_TRIAL_TARGETS.length - 1];
}

/**
 * 玩家已經二轉過的一轉職業集合。
 * 用於「同一個一轉職業的分支只能選一個」——選了劍聖就永遠不能再拿大劍。
 */
function ownedT2BaseKeys(itemIds) {
  const ids = itemIds instanceof Set ? itemIds : new Set(Array.isArray(itemIds) ? itemIds : []);
  const keys = new Set();
  for (const id of ids) {
    const branch = getT2Branch(id);
    if (branch && branch.baseKey) keys.add(branch.baseKey);
  }
  return keys;
}

module.exports = {
  T2_LEVEL_REQUIREMENT,
  T2_MAX_OWNED,
  T2_TRIAL_TARGETS,
  BASE_JOBS,
  T2_BRANCHES,
  battleMetricFor,
  allBattleMetrics,
  isT2BadgeId,
  getT2Branch,
  getBranchesForBase,
  getBaseKeyByBadgeId,
  countOwnedT2,
  ownedT2BaseKeys,
  trialTargetFor,
};
