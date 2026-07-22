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
 *   - 同一個一轉職業的分支只能選一個（選了聖劍士就不能再拿大劍）
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
 *     id:        "job_holyblade_t2_v1",     // 徽章 itemId，必須以 job_ 開頭、含 _t2_
 *     key:       "holyblade",
 *     name:      "聖劍士",
 *     theme:     "盾牌格擋反擊",              // 一句話定位，給後台/文件看
 *     towerAura: { key: "party_damage_reduction", value: 8, notes: "爬塔：隊伍受到傷害 -8%" },
 *     stances:   { ... }                      // 選配：戰鬥姿態（見聖劍士）
 *   }
 */
const T2_BRANCHES = {
  swordsman: [
    {
      id: "job_holyblade_t2_v1",
      key: "holyblade",
      name: "聖劍士",
      theme: "攻守姿態切換",
      towerAura: { key: "party_damage_reduction", value: 8, notes: "爬塔：隊伍受到傷害 -8%" },
      // 戰鬥姿態：開打前選一個，整場適用（戰鬥是一次跑完 15 回合，中途無法切換）。
      // combatLoop 只認這張表，不寫死職業判斷 → 之後別的二轉要做姿態照同格式填即可。
      // 戰鬥畫面的行動按鈕（最多 4 顆，槽位固定；不同職業只換名稱與行為）
      battleActions: [
        { slot: 1, key: "attack",  label: "攻擊", icon: "⚔️", tone: "gold",  kind: "stance" },
        { slot: 2, key: "defense", label: "防禦", icon: "🛡️", tone: "steel", kind: "stance", requiresShield: true },
      ],
      stances: {
        attack: {
          label: "攻擊",
          blockChance: 30,          // 覆寫格擋率（劍士原本 60）
          // 保證站在屬性相剋的優勢方：武器屬性等級 < upgradeFromWeaponLevel → baseLevel，否則 upgradedLevel
          guaranteedElement: { baseLevel: 2, upgradedLevel: 4, upgradeFromWeaponLevel: 2 },
        },
        defense: {
          label: "防禦",
          blockChance: 70,
          shieldBashPct: 60,        // 格擋成功時追加盾擊＝ATK 的 60%
          requiresShield: true,
        },
      },
    },
    {
      id: "job_swordoni_t2_v1",
      key: "swordoni",
      name: "劍鬼",
      theme: "區域連段（COMBO）",
      towerAura: { key: "party_damage_up", value: 6, notes: "爬塔：隊伍傷害 +6%" },
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "⚔️", tone: "gold",    kind: "normal" },
        { slot: 2, key: "burst",  label: "斬",   icon: "🗡️", tone: "crimson", kind: "combo_burst", requiresCombo: 30 },
      ],
      // 劍鬼不用姿態系統，改吃 zoneCombo（見 src/shared/zoneCombo.js）：
      //   被動 — 連段階梯加成（攻擊力/吸血/爆擊率/爆擊傷害，99 吃滿）
      //   被動 — 不屈：第一次陣亡連段減半，連續第二次才歸零
      //   主動 — 斬：連段 ≥30 時可消耗全部連段，第 1 回合打出無視防禦與等級差的一擊
      combo: true,
    },
  ],
  warrior: [
    {
      id: "job_berserker_t2_v1",
      key: "berserker",
      name: "狂戰士",
      theme: "血量是燃料（血怒／血祭／戰意集氣）",
      towerAura: { key: "party_damage_up", value: 5, notes: "爬塔：隊伍傷害 +5%" },
      battleActions: [
        { slot: 1, key: "attack",    label: "攻擊", icon: "⚔️", tone: "gold",    kind: "normal" },
        { slot: 2, key: "sacrifice", label: "血祭", icon: "🩸", tone: "crimson", kind: "sacrifice" },
      ],
      // 血怒（被動）：每缺 1% HP → 該回合 ATK +1.2%，封頂 +60%。
      // 逐回合看「當下」HP——實裝實測(400場/組)：世界王 1.21x、中怪 1.17x、小怪 1.0x。
      // （初版 0.6%/50 的紙面估算高估了：常數近似從第 1 回合就生效，真實血怒前期沒加成，
      //   實裝只剩 1.03~1.11x 完全沒二轉感 → 上調到 1.2/60。）
      bloodRage: { perMissPct: 1.2, capPct: 60 },
      // 血祭（開打前選擇）：付出當前 HP 30%，整場 ATK +25%。
      // ⚠️ 刻意不帶吸血——血怒讓玩家常駐低血，吸血每一口都是大回復，
      //    帶 10% 吸血實測世界王 2.31x 直接爆表。
      // 血怒1.2 + 血祭25 實測：世界王 1.40x、中怪 1.33x(勝率12%→41%)，
      // 加上滿氣場約每 6 場一次 → 持續輸出貼齊聖劍士的 1.50x。
      sacrifice: { hpCostPct: 30, atkUpPct: 25 },
      // 戰意集氣（被動）：每打完一場 +1 格，集滿下一場追加爆擊率並清空重集。
      // DC 與網頁共用；滿氣自動觸發，不用按。
      gauge: { max: 5, critRateBonus: 30 },
    },
  ],
  dwarf_warrior: [
    {
      id: "job_dwarflord_t2_v1",
      key: "dwarflord",
      name: "矮人戰士長",
      theme: "世界王暈眩條（巨神震擊）— 團隊開關",
      towerAura: { key: "party_damage_reduction", value: 6, notes: "爬塔：隊伍受到傷害 -6%" },
      // 沒有第二顆按鈕：巨神震擊是被動累積，打就是敲，不用選
      battleActions: [
        { slot: 1, key: "attack", label: "攻擊", icon: "⚔️", tone: "gold", kind: "normal" },
      ],
      // 巨神震擊：規則與狀態都在 src/shared/dwarfStunGauge.js
      //   只有這個徽章敲得動世界王的暈眩條（敲擊量＝實際有攻擊到的回合數），
      //   敲滿全服共享 20 秒暈眩窗口 → 期間任何人出戰都整場免傷，之後 2 分鐘免疫。
      stunGauge: true,
      // 暈眩專精（矮人戰士長的核心）：暈眩是他的武器，不是運氣。
      //   defIgnoreVsStunned — 被動「山碎」：對暈眩中的目標無視防禦%（固定防禦 flatDef 仍在）
      //   bossStunCap        — 被動「巨神之握」：世界王暈眩上限 1 → 2 回合
      //                        （combatLoop 原本一律 min(1) 防單人鎖王，這是全遊戲唯一的例外）
      // 兩者都吃「回合暈眩」與「時間暈眩（巨神震擊）」。
      stunMastery: { defIgnoreVsStunned: 100, bossStunCap: 2 },
    },
  ],
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
 * 用於「同一個一轉職業的分支只能選一個」——選了聖劍士就永遠不能再拿大劍。
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

/**
 * 解析玩家這場戰鬥要套用的姿態設定。
 * @param {object} jobEq      已裝備的職業徽章（progress.equipment.job_eq）
 * @param {string} stanceKey  玩家選的姿態（"attack" / "defense"）
 * @returns {object|null}     姿態設定；徽章沒有姿態系統或 key 不存在 → null（＝完全走現況）
 */
function resolveStance(jobEq, stanceKey) {
  if (!jobEq || !stanceKey) return null;
  const branch = getT2Branch(String(jobEq.itemId || jobEq.id || ""));
  const stance = branch && branch.stances ? branch.stances[String(stanceKey)] : null;
  return stance ? { ...stance, key: String(stanceKey), jobName: branch.name } : null;
}

/** 這個徽章有沒有姿態系統（前端要不要渲染兩顆按鈕） */
function getStances(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.stances ? branch.stances : null;
}

/** 血怒設定（狂戰士）：徽章沒有就 null → combatLoop 完全走現況 */
function getBloodRage(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.bloodRage ? { ...branch.bloodRage, jobName: branch.name } : null;
}

/** 血祭設定（狂戰士）：開打前選擇，付 HP 換整場 ATK */
function getSacrifice(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.sacrifice ? { ...branch.sacrifice, jobName: branch.name } : null;
}

/**
 * ⭐ 全遊戲判斷「這個徽章算哪個職業」的**唯一入口**。
 *
 * 一轉徽章 → 自己的 key；二轉徽章 → 它的 baseKey（繼承一轉的所有程式碼內建加成）。
 *
 * 為什麼一定要走這裡：職業加成有一大半**寫在程式碼裡、不在道具資料上**
 * （劍士的格擋反擊、矮人的對暈眩加傷、盜賊的連擊率破百…），
 * 以前各檔案各自用 `id.includes("swordsman") || name.includes("劍士")` 判斷 →
 * 二轉徽章只要名字沒撞上關鍵字就整組失效。
 * 實例：**劍鬼**（id `job_swordoni_t2_v1`、名「劍鬼徽章」）兩個都不中，
 * 少了雙手劍格擋 +5% 與**格擋反擊**，實測比一轉劍士還弱 10%。
 *
 * 新增職業只要登記進 BASE_JOBS / T2_BRANCHES，所有判定自動正確。
 */
function resolveJobKey(jobEq) {
  if (!jobEq) return null;
  const id = String(jobEq.itemId || jobEq.id || "");
  const t2 = getT2Branch(id);
  if (t2) return t2.baseKey;
  const base = getBaseKeyByBadgeId(id);
  if (base) return base;
  return legacyGuessJobKey(jobEq);
}

/**
 * 後備：沒登記在 BASE_JOBS / T2_BRANCHES 的徽章（舊資料、後台自訂）才走字串比對。
 * 正常情況不該用到——用到代表有徽章沒登記。
 */
const LEGACY_MATCHERS = [
  ["barrier_mage",  ["barrier_mage"], ["結界"]],
  ["dwarf_warrior", ["dwarf"],        ["矮人"]],
  ["healer",        ["healer"],       ["治療"]],
  ["tactician",     ["tactician"],    ["軍師"]],
  ["bard",          ["bard"],         ["詩人"]],
  ["gambler",       ["gambler"],      ["賭徒"]],
  ["swordsman",     ["swordsman"],    ["劍士"]],
  ["warrior",       ["warrior"],      ["戰士"]],
  ["archer",        ["archer"],       ["弓箭手"]],
  ["rogue",         ["rogue"],        ["盜賊"]],
  ["mage",          ["mage"],         ["法師"]],
];
function legacyGuessJobKey(jobEq) {
  const id = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const name = String(jobEq?.itemName || jobEq?.name || "");
  // 順序有意義：結界師/矮人戰士要排在法師/戰士前面，否則會被前綴吃掉
  for (const [key, ids, names] of LEGACY_MATCHERS) {
    if (ids.some((x) => id.includes(x)) || names.some((x) => name.includes(x))) return key;
  }
  return null;
}

/** 這個徽章是不是某個一轉職業（含其二轉分支）。全遊戲的職業判定都該用這個。 */
function isJob(jobEq, baseKey) {
  return resolveJobKey(jobEq) === baseKey;
}

/** 職業 key → 中文名（顯示用） */
function jobDisplayName(baseKey) {
  return BASE_JOBS[baseKey]?.name || null;
}

/** 暈眩專精設定（矮人戰士長）：沒有這套的職業回 null → combatLoop 完全走現況 */
function getStunMastery(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.stunMastery ? { ...branch.stunMastery, jobName: branch.name } : null;
}

/** 戰意集氣設定（狂戰士）：沒有集氣系統的職業回 null */
function getGauge(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  return branch && branch.gauge ? { ...branch.gauge, jobName: branch.name } : null;
}

/** 戰鬥畫面最多支援幾顆行動按鈕（槽位固定，前端照 slot 排） */
const MAX_BATTLE_ACTIONS = 4;

/** 預設按鈕：沒有二轉徽章（或該二轉沒宣告）的職業就這一顆 */
const DEFAULT_BATTLE_ACTIONS = [
  { slot: 1, key: "attack", label: "戰鬥開始", icon: "⚔️", tone: "gold", kind: "normal" },
];

/**
 * 取得這個職業徽章在戰鬥畫面要顯示的行動按鈕。
 * 前端只認 slot / label / icon / tone / kind，新增職業不用改前端。
 */
function getBattleActions(jobEq) {
  const branch = getT2Branch(String(jobEq?.itemId || jobEq?.id || ""));
  const list = branch && Array.isArray(branch.battleActions) && branch.battleActions.length > 0
    ? branch.battleActions
    : DEFAULT_BATTLE_ACTIONS;
  return list.slice(0, MAX_BATTLE_ACTIONS).map((a) => ({ ...a }));
}

module.exports = {
  MAX_BATTLE_ACTIONS,
  DEFAULT_BATTLE_ACTIONS,
  getBattleActions,
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
  resolveStance,
  getStances,
  getBloodRage,
  getSacrifice,
  getGauge,
  getStunMastery,
  resolveJobKey,
  isJob,
  jobDisplayName,
};
