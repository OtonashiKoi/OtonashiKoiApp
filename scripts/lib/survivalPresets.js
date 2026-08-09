"use strict";
/**
 * 生存矩陣的「職業 × 原型」預設表（V0.5 驗收工具的資料層）。
 *
 * 設計依據：docs/SEASON_NEXT_SURVIVAL_15R_DESIGN.md
 *   四原型＝重甲 / 閃避 / 回復 / 護盾；這裡另加「輸出基準」當分母
 *   （驗收條件：生存 build 的輸出 ≥ 同職業輸出 build 的 40%）。
 *
 * 配點模型（2026-08-07 二度更新，對應「2+1 制」實裝）：每級隨機 2 點＋自主 1 點
 * （progressService 升級迴圈 + statusPoints 池 + allocateAttribute）。
 * Lv50 期望 ＝ 隨機 98 點平均分六維 ＋ 自主 49 點依原型分配（preset.alloc，總和須 = 49）。
 * armorTo 仍決定防具集中屬性（裝備面差異）。
 *
 * 防具中和：沿用 balance-job-matrix 的做法（防具攻擊向屬性歸零、VIT 保留、
 * 集中 +55 到一個屬性），+55 放到哪由原型的 armorTo 決定——
 * 這讓「重甲原型」等價於在測「一條 VIT 向防具線」的效果，
 * 不用先把新防具做進 DB 就能回答「做了值不值得」。
 */

/** 職業 → [顯示名, 徽章id, S階武器類型, 主屬性, 額外戰鬥選項] */
const ALL_JOBS = [
  ["一轉 劍士",       "job_swordsman_v1",       "sword_2h", "str"],
  ["一轉 戰士",       "job_warrior_v1",         "axe_2h",   "str"],
  ["一轉 矮人戰士",   "job_dwarf_warrior_v1",   "mace_2h",  "str"],
  ["一轉 盜賊",       "job_rogue_v1",           "dagger",   "agi", { _dualDagger: true }],
  ["一轉 法師",       "job_mage_v1",            "staff_2h", "int"],
  ["一轉 治療師",     "job_healer_v1",          "staff_1h", "int"],
  ["一轉 弓箭手",     "job_archer_v1",          "bow",      "dex"],
  // 軍師系配法杖：遊戲無職業武器限制，INT 配點的理性選擇是杖（吃 INT、mult 3）——
  // 舊表塞單手劍（吃 STR）害他 ATK 145 被誤判為輸出殘廢
  ["一轉 軍師",       "job_tactician_v1",       "staff_1h", "int"],
  ["一轉 詩人",       "job_bard_v1",            "bow",      "dex"],
  ["一轉 結界師",     "job_barrier_mage_v1",    "staff_1h", "int"],
  ["一轉 賭徒",       "job_gambler_v1",         "dice",     "luk"],
  ["二轉 聖劍士(攻)", "job_holyblade_t2_v1",    "sword_2h", "str", { stance: "attack" }],
  ["二轉 聖劍士(防)", "job_holyblade_t2_v1",    "sword_1h", "str", { stance: "defense", _shield: true }],
  ["二轉 劍鬼",       "job_swordoni_t2_v1",     "sword_2h", "str"],
  ["二轉 狂戰士",     "job_berserker_t2_v1",    "axe_2h",   "str"],
  ["二轉 矮人戰士長", "job_dwarflord_t2_v1",    "mace_2h",  "str"],
  ["二轉 影舞者",     "job_shadowdancer_t2_v1", "dagger",   "agi", { _dualDagger: true }],
  ["二轉 元素師",     "job_elementalist_t2_v1", "staff_2h", "int"],
  ["二轉 聖靈師",     "job_spiritmaster_t2_v1", "staff_1h", "int"],
  ["二轉 神射手",     "job_sniper_t2_v1",       "bow",      "dex"],
  ["二轉 兵聖",       "job_sage_t2_v1",         "staff_1h", "int"],
  ["二轉 吟遊詩人",   "job_minstrel_t2_v1",     "bow",      "dex"],
  ["二轉 聖域師",     "job_sanctum_t2_v1",      "staff_1h", "int"],
  ["二轉 賭神",       "job_dicegod_t2_v1",      "dice",     "luk"],
];

// 本季封印的二轉（jobAdvancement.seasonLocked）自動剔除——模擬只量「玩家實際會遇到的世界」。
// 要連封印職業一起量（做下季內容時）：SIM_INCLUDE_LOCKED=1。
const JOBS = ALL_JOBS.filter(([, badgeId]) => {
  if (process.env.SIM_INCLUDE_LOCKED === "1") return true;
  try { return !require("../../src/shared/jobAdvancement").isSeasonLockedT2(badgeId); }
  catch (_) { return true; }
});

/**
 * 原型 → 44 自由點的分配 ＋ 防具集中屬性。
 * alloc 的 key：main（主屬性）或六維名；值加總必須 = 44。
 */
// alloc ＝ 49 點自主點的分配方向（2+1 制玩家真的可以這樣選）
const PRESETS = [
  { key: "output", label: "輸出基準", alloc: { main: 49 },           armorTo: "main" },
  { key: "heavy",  label: "重甲坦",   alloc: { vit: 49 },            armorTo: "vit"  },
  { key: "dodge",  label: "閃避",     alloc: { agi: 49 },            armorTo: "agi"  },
  { key: "regen",  label: "回復",     alloc: { int: 49 },            armorTo: "int"  },
  { key: "hybrid", label: "混合",     alloc: { main: 25, vit: 24 },  armorTo: "vit" },
];

/** 六維配點（2+1 制期望模型，對應 progressService 實裝）：
 *  隨機部分 98 點平均分六維（16×6=96，餘 2 給 vit/luk）＋ 自主 49 點依 preset.alloc。
 *  ⚠️ 隨機部分永遠平均、不准手選（使用者鐵則）；自主部分才能依原型傾斜。
 */
function buildAttrs(mainStat, preset) {
  const a = { str: 16, agi: 16, vit: 17, int: 16, dex: 16, luk: 17 }; // 隨機 98 點期望
  for (const [k, v] of Object.entries(preset?.alloc || {})) {
    a[k === "main" ? mainStat : k] += v;
  }
  return a;
}

/**
 * 組裝該職業＋原型的整套裝備（借基準玩家防具 → 中和 → 換武器/徽章/盾）。
 * @returns {Promise<object|null>} equipment；缺徽章或武器時回 null
 */
async function buildEquipment(items, baseEquipment, job, preset) {
  const [, badgeId, wt, mainStat, extra = {}] = job;
  const badge = await items.findOne({ id: badgeId });
  const weapon = await items.findOne({ weaponType: wt, tier: "S" });
  if (!badge || !weapon) return null;

  const eq = JSON.parse(JSON.stringify(baseEquipment || {}));
  eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "sim-badge" };
  eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "sim-weapon", enhanceLevel: 0 };
  delete eq.offhand; delete eq.shield;
  if (extra._dualDagger) {
    const off = await items.findOne({ weaponType: "offhand_dagger", tier: "A" });
    if (off) eq.shield = { ...off, itemId: off.id, itemName: off.name, uuid: "sim-off", enhanceLevel: 0 };
  }
  if (extra._shield) {
    const shield = await items.findOne({ equipSlot: "shield", tier: "A", weaponType: null });
    if (shield) eq.shield = { ...shield, itemId: shield.id, itemName: shield.name, uuid: "sim-shield", enhanceLevel: 0 };
  }

  // 防具中和：攻擊向歸零、VIT 保留、+55 集中到原型指定屬性（見檔頭說明）
  const ARMOR_MAIN = 55;
  const armorStat = preset.armorTo === "main" ? mainStat : preset.armorTo;
  let given = false;
  for (const [slot, it] of Object.entries(eq)) {
    if (slot === "weapon" || slot === "job_eq" || !it?.equipStats) continue;
    const vit = Number(it.equipStats.vit) || 0;
    const zero = { str: 0, agi: 0, vit, int: 0, dex: 0, luk: 0 };
    if (!given) { zero[armorStat] += ARMOR_MAIN; given = true; }
    eq[slot] = { ...it, equipStats: zero };
  }
  return eq;
}

/** 該職業＋原型的戰鬥額外選項（姿態等；內部旗標 _xxx 已剝除） */
function buildExtraOptions(job) {
  const extra = job[4] || {};
  const { _dualDagger, _shield, playerActiveEffects, ...rest } = extra;
  return { ...rest, ...(playerActiveEffects ? { playerActiveEffects } : {}) };
}

module.exports = { JOBS, PRESETS, buildAttrs, buildEquipment, buildExtraOptions };
