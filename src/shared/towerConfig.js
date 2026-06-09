"use strict";

// ── 組隊爬塔系統設定 ─────────────────────────────────────────────────────────
// 最多 6 人，隊長發起，開始後鎖定成員
// 共 52 關：
//   1~40 層 普通段（每 10 層段王）
//   41~50 層 龍族之領（50 層段王＝龍王(B)）
//   51 層 大史王（世界王）／52 層 古龍王(B)（終局世界王）
// ────────────────────────────────────────────────────────────────────────────

const TOWER_MAX_MEMBERS = 6;
const TOWER_TOTAL_FLOORS = 52; // 1~40 普通 + 41~50 龍族之領 + 51 大史王 + 52 古龍王
const TOWER_BOSS_FLOOR = 52;   // 最終王（古龍王）

// ── 樓層 Buff 區段 ────────────────────────────────────────────────────────────
// 玩家打到該區段就會取得對應 Buff，累加不替換
const TOWER_FLOOR_BUFFS = [
  {
    minFloor: 1,
    maxFloor: 10,
    label: "初啟之境",
    emoji: "🌿",
    color: 0x2ecc71,
    // 達到此段的隊伍加成（攻擊+5%、HP+10%）
    partyBonus: { atkPct: 5, hpPct: 10 },
    monsterScalePct: 100, // 怪物基礎HP為原始 x 100%
    monsterAtkScalePct: 100,
  },
  {
    minFloor: 11,
    maxFloor: 20,
    label: "試煉深淵",
    emoji: "🔥",
    color: 0xe67e22,
    partyBonus: { atkPct: 10, hpPct: 20 },
    monsterScalePct: 180,
    monsterAtkScalePct: 150,
  },
  {
    minFloor: 21,
    maxFloor: 30,
    label: "混沌邊境",
    emoji: "⚡",
    color: 0x9b59b6,
    partyBonus: { atkPct: 20, hpPct: 40 },
    monsterScalePct: 320,
    monsterAtkScalePct: 250,
  },
  {
    minFloor: 31,
    maxFloor: 40,
    label: "滅世熔爐",
    emoji: "💀",
    color: 0xe74c3c,
    partyBonus: { atkPct: 35, hpPct: 70 },
    monsterScalePct: 420,
    monsterAtkScalePct: 320,
  },
  {
    minFloor: 41,
    maxFloor: 50,
    label: "龍族之領",
    emoji: "🐲",
    color: 0xc0392b,
    partyBonus: { atkPct: 42, hpPct: 85 },
    monsterScalePct: 350,    // 龍怪 base 12k~25k → 42k~87.5k；段王龍王(B) 100k → 350k
    monsterAtkScalePct: 300,
  },
  {
    minFloor: 51,
    maxFloor: 52,
    label: "終焉雙王",
    emoji: "👑",
    color: 0x1a1a2e,
    partyBonus: { atkPct: 55, hpPct: 110 },
    monsterScalePct: 100,    // 世界王本身已巨大（大史王 177萬／古龍王 265萬），不再放大
    monsterAtkScalePct: 100,
  },
];

// ── 固定王關（單一來源）────────────────────────────────────────────────────
// DC 組隊爬塔與網頁版爬塔共用，避免兩邊各寫一份而分歧。
// 廢都魔王(B) 強度過高不列入爬塔。
const TOWER_FLOOR_BOSS = {
  10: "大野兔(B)",
  20: "米拉桑(B)",
  30: "古城將軍(B)",
  40: "城堡魔像(B)",
  50: "龍王(B)",      // 龍族之領 段王
  51: "大史王",        // 世界王
  52: "古龍王(B)",     // 終局世界王
};
function getTowerFloorBossName(floor) {
  return TOWER_FLOOR_BOSS[floor] || null;
}

// ── 怪物選取策略 ──────────────────────────────────────────────────────────────
// 每層依樓層比例從 DB 怪物中選取，固定王關走 TOWER_FLOOR_BOSS
const TOWER_MONSTER_ZONE_POOL = {
  "1-10":  { zone: "normal",  bossOnly: false },
  "11-20": { zone: "mid",     bossOnly: false },
  "21-25": { zone: "ancient_city",      bossOnly: false },
  "26-30": { zone: "ancient_city_deep", bossOnly: false },
  "31-40": { zone: "elite",   bossOnly: false },
  "41-50": { zone: "dragon_realm", bossOnly: false }, // 龍族之領（50 層段王走 TOWER_FLOOR_BOSS）
  "51":    { zone: "elite",            bossOnly: true }, // 大史王
  "52":    { zone: "dragon_king_lair", bossOnly: true }, // 古龍王
};

// ── 隊伍行動軸規則 ──────────────────────────────────────────────────────────
// 每層戰鬥：玩家與怪物都依 AGI 速度條排軸；怪物死亡即過關。
// 此數值保留舊名稱供相容使用，實際會換算成每層最大行動切片，避免無限迴圈。
const MAX_ROUNDS_PER_MEMBER = 65;

// ── 戰場連結 HP 規則 ──────────────────────────────────────────────────────────
// 隊員 HP 在整場攻塔期間持續消耗，不回血，只有層間 Buff 加成最大HP
// 若某層戰鬥中全員 HP 歸 0 → 該層失敗，記錄最高通過層
const TOWER_HP_REGEN_PER_FLOOR = 0; // 每層之間回血（0 = 不回）

// ── 等候大廳逾時 ─────────────────────────────────────────────────────────────
const TOWER_LOBBY_TIMEOUT_MS = 10 * 60 * 1000; // 10 分鐘未開始 → 自動解散

// ── 個人紀錄欄位（存在 progress） ────────────────────────────────────────────
// progress.towerRecord = { bestFloor: number, bestAt: ISO string, totalRuns: number }

// ── 攻塔限制 ─────────────────────────────────────────────────
const TOWER_MIN_LEVEL = 30;          // 最低等級限制
const TOWER_HOURLY_LIMIT = 10;       // 每人每小時最多挑戰次數
const TOWER_HOURLY_WINDOW_MS = 60 * 60 * 1000; // 1 小時滑動窗口

// ── 過關 Buff（僅限怪物區，刷新不疊加） ─────────────────────
// key: 每個 buff 的唯一 sourceId，用於 refresh 判斷
// effects 可包含多個 effect ref
const TOWER_CLEAR_BUFFS = [
  {
    minFloor: 15,
    label: "攻塔祝福 Lv.1",
    durationSec: 1800,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.05 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
    ],
  },
  {
    minFloor: 20,
    label: "攻塔祝福 Lv.2",
    durationSec: 1800,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.07 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
    ],
  },
  {
    minFloor: 25,
    label: "攻塔祝福 Lv.3",
    durationSec: 1800,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.10 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
    ],
  },
  {
    minFloor: 30,
    label: "攻塔祝福 Lv.4",
    durationSec: 3600,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.10 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
      { key: "def_multiplier_up", params: { value: 1.05 }, sourceType: "tower_buff", sourceId: "tower_def_buff" },
    ],
  },
  {
    minFloor: 35,
    label: "攻塔祝福 Lv.5",
    durationSec: 3600,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.12 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
      { key: "def_multiplier_up", params: { value: 1.08 }, sourceType: "tower_buff", sourceId: "tower_def_buff" },
    ],
  },
  {
    minFloor: 40,
    label: "攻塔祝福 Lv.6",
    durationSec: 3600,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.15 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
      { key: "def_multiplier_up", params: { value: 1.10 }, sourceType: "tower_buff", sourceId: "tower_def_buff" },
    ],
  },
  {
    minFloor: 41,
    label: "攻塔祝福 Lv.7（終焉）",
    durationSec: 3600,
    effects: [
      { key: "atk_multiplier_up", params: { value: 1.15 }, sourceType: "tower_buff", sourceId: "tower_atk_buff" },
      { key: "def_multiplier_up", params: { value: 1.10 }, sourceType: "tower_buff", sourceId: "tower_def_buff" },
      { key: "max_hp_multiplier_up", params: { value: 1.15 }, sourceType: "tower_buff", sourceId: "tower_hp_buff" },
    ],
  },
];

// 取得指定層數應給予的 buff tier（最高符合者），沒有則回 null
function getTowerClearBuff(clearedFloor) {
  const sorted = [...TOWER_CLEAR_BUFFS].sort((a, b) => b.minFloor - a.minFloor);
  return sorted.find((b) => clearedFloor >= b.minFloor) || null;
}

// ── 獎勵規則 ─────────────────────────────────────────────────────────────────
const TOWER_FLOOR_REWARD = {
  10:  { goldMultiplier: 1.0,  expMultiplier: 1.0,  bonusMsg: "突破初境！" },
  20:  { goldMultiplier: 2.5,  expMultiplier: 2.5,  bonusMsg: "深淵征服！" },
  30:  { goldMultiplier: 5.0,  expMultiplier: 5.0,  bonusMsg: "混沌突破！" },
  40:  { goldMultiplier: 10.0, expMultiplier: 10.0, bonusMsg: "熔爐超越！" },
  50:  { goldMultiplier: 18.0, expMultiplier: 18.0, bonusMsg: "🐲 龍族之領鎮壓！龍王伏誅！" },
  51:  { goldMultiplier: 28.0, expMultiplier: 28.0, bonusMsg: "⚔️ 大史王討伐！" },
  52:  { goldMultiplier: 45.0, expMultiplier: 45.0, bonusMsg: "🎉 古龍王討伐！傳說等級！" },
};

// 基礎獎勵（每通過一層）
const TOWER_BASE_REWARD_PER_FLOOR = { gold: 150, exp: 80 };

// ── 工具函式 ─────────────────────────────────────────────────────────────────

function getTowerFloorBuff(floor) {
  return TOWER_FLOOR_BUFFS.find((b) => floor >= b.minFloor && floor <= b.maxFloor)
    || TOWER_FLOOR_BUFFS[0];
}

function getTowerMonsterPool(floor) {
  if (floor >= 52) return TOWER_MONSTER_ZONE_POOL["52"];
  if (floor >= 51) return TOWER_MONSTER_ZONE_POOL["51"];
  if (floor >= 41) return TOWER_MONSTER_ZONE_POOL["41-50"];
  if (floor >= 31) return TOWER_MONSTER_ZONE_POOL["31-40"];
  if (floor >= 26) return TOWER_MONSTER_ZONE_POOL["26-30"];
  if (floor >= 21) return TOWER_MONSTER_ZONE_POOL["21-25"];
  if (floor >= 11) return TOWER_MONSTER_ZONE_POOL["11-20"];
  return TOWER_MONSTER_ZONE_POOL["1-10"];
}

// 計算該層怪物的實際 HP / ATK（基於原始數值 × 倍率）
function scaleTowerMonsterHp(baseHp, floor) {
  const buff = getTowerFloorBuff(floor);
  return Math.round(baseHp * (buff.monsterScalePct / 100));
}

function scaleTowerMonsterAtk(baseAtk, floor) {
  const buff = getTowerFloorBuff(floor);
  return Math.round(baseAtk * (buff.monsterAtkScalePct / 100));
}

// 計算隊伍在到達 floor 時的累積 Buff 加成（取最高段）
function getCumulativePartyBonus(floor) {
  let atkPct = 0;
  let hpPct = 0;
  for (const buff of TOWER_FLOOR_BUFFS) {
    if (floor >= buff.minFloor) {
      atkPct = Math.max(atkPct, buff.partyBonus.atkPct);
      hpPct  = Math.max(hpPct,  buff.partyBonus.hpPct);
    }
  }
  return { atkPct, hpPct };
}

// 計算本次攻塔的獎勵（依最高通關層）
function calcTowerReward(clearedFloor) {
  if (clearedFloor < 1) return { gold: 0, exp: 0, bonusMsg: null, multiplier: 0 };
  const base = TOWER_BASE_REWARD_PER_FLOOR;
  let multiplier = 1.0;
  let bonusMsg = null;

  const milestones = Object.keys(TOWER_FLOOR_REWARD)
    .map(Number)
    .filter((f) => clearedFloor >= f)
    .sort((a, b) => b - a);

  if (milestones.length > 0) {
    const best = TOWER_FLOOR_REWARD[milestones[0]];
    multiplier = best.goldMultiplier;
    bonusMsg = best.bonusMsg;
  }

  return {
    gold: Math.round(base.gold * clearedFloor * multiplier),
    exp:  Math.round(base.exp  * clearedFloor * multiplier),
    bonusMsg,
    multiplier,
  };
}

module.exports = {
  TOWER_MAX_MEMBERS,
  TOWER_TOTAL_FLOORS,
  TOWER_BOSS_FLOOR,
  TOWER_FLOOR_BOSS,
  getTowerFloorBossName,
  TOWER_FLOOR_BUFFS,
  TOWER_LOBBY_TIMEOUT_MS,
  MAX_ROUNDS_PER_MEMBER,
  TOWER_HP_REGEN_PER_FLOOR,
  TOWER_BASE_REWARD_PER_FLOOR,
  TOWER_FLOOR_REWARD,
  TOWER_MIN_LEVEL,
  TOWER_HOURLY_LIMIT,
  TOWER_HOURLY_WINDOW_MS,
  TOWER_CLEAR_BUFFS,
  getTowerFloorBuff,
  getTowerMonsterPool,
  scaleTowerMonsterHp,
  scaleTowerMonsterAtk,
  getCumulativePartyBonus,
  calcTowerReward,
  getTowerClearBuff,
};
