"use strict";
const { collectEquipmentEffects, applyEffectsToStats } = require("./effectEngine");
const { getEquipmentTierSetBonuses, TIER_SET_SLOTS } = require("./equipmentTierSetBonuses");
const { getBossBoostPct, PK_RATING_DEFAULT } = require("./pkArenaConfig");

// ─────────────────────────────────────────────
// 武器設定表
// mult        : ATK 倍率
// baseStat    : 主屬性（預設 "str"）
// isTwoHanded : 是否雙手（不可配副手武器）
// comboBonus  : 連擊率加成%
// stunChance  : 擊暈機率%
// stunDuration: 擊暈持續回合數
// armorBreak  : 破防機率%（此次攻擊無視 DEF%）
// critBonus   : 爆擊率加成%
// bypassDefPct: 無視對方 DEF 的百分比
// dodgeBonus  : 閃避率加成%
// ─────────────────────────────────────────────
const WEAPON_CONFIG = {
  sword_1h: { mult: 4 },
  sword_2h: { mult: 5, isTwoHanded: true },
  mace_1h:  { mult: 3, stunChance: 10, stunDuration: 3 },
  mace_2h:  { mult: 4, isTwoHanded: true, stunChance: 8, stunDuration: 3 },
  axe_1h:   { mult: 3, armorBreak: 15, critBonus: 10 },
  axe_2h:   { mult: 5, isTwoHanded: true, armorBreak: 15, critBonus: 20 },
  dagger:   { mult: 2, comboBonus: 20 },
  staff_1h: { mult: 3, baseStat: "int", bypassDefPct: 15 },
  staff_2h: { mult: 4, baseStat: "int", isTwoHanded: true, bypassDefPct: 25 },
  bow:      { mult: 4, baseStat: "dex", isTwoHanded: true, dodgeBonus: 20 },
};

// 副手武器種類（可雙持）
const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);
const EQUIPPED_TIER_SLOTS = TIER_SET_SLOTS;

// 雙持時主手不同武器的副手追擊機率
const DUAL_COUNTER_CHANCE = {
  sword_1h: 20,
  mace_1h:  20,
  axe_1h:   20,
  dagger:   40,
};

/**
 * 依玩家基礎屬性與已裝備物品計算戰鬥數值。
 */
function calcPlayerStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = {}, equipped = {}, activeEffects = [], inventory = [], { pkRating } = {}) {
  const tierSetBonuses = getEquipmentTierSetBonuses(equipped);

  // 裝備加成
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const S = str + bonus.str + tierSetBonuses.stats.str;
  const A = agi + bonus.agi;
  const V = vit + bonus.vit;
  const I = INT + bonus.int + tierSetBonuses.stats.int;
  const D = dex + bonus.dex + tierSetBonuses.stats.dex;
  const L = luk + bonus.luk;

  const weapon  = equipped.weapon || null;
  const offhand = equipped.shield || null;
  const wt      = weapon?.weaponType || null;
  const cfg     = WEAPON_CONFIG[wt] || {};
  
  // 職業徽章效果檢測
  const jobEq = equipped.job_eq || null;
  const jobId = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const jobName = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
  const hasArcherBadge = jobEq && (jobId.includes("archer") || jobName.includes("弓箭手"));
  const hasSwordsmanBadge = jobEq && (jobId.includes("swordsman") || jobName.includes("劍士"));
  const hasWarriorBadge = jobEq && (jobId === "job_warrior_v1" || (jobName.includes("戰士") && !jobName.includes("矮人")));
  const hasDwarfWarriorBadge = jobEq && (jobId === "job_dwarf_warrior_v1" || jobName.includes("矮人戰士"));
  const hasRogueBadge = jobEq && (jobId.includes("rogue") || jobName.includes("盜賊"));
  const hasMageBadge = jobEq && (jobId.includes("mage") && !jobId.includes("barrier") || jobName.includes("法師") && !jobName.includes("結界"));
  const hasHealerBadge = jobEq && (jobId.includes("healer") || jobName.includes("治療"));
  const hasTacticianBadge = jobEq && (jobId.includes("tactician") || jobName.includes("軍師"));
  const hasBardBadge = jobEq && (jobId.includes("bard") || jobName.includes("詩人"));
  const hasBarrierMageBadge = jobEq && (jobId.includes("barrier_mage") || jobName.includes("結界"));

  // 雙持判定：主手非雙手武器 + 副手是武器類型
  const isDualWield = !cfg.isTwoHanded && wt && offhand?.weaponType != null && OFFHAND_WEAPON_TYPES.has(offhand.weaponType);

  // baseStat
  const baseStatKey = cfg.baseStat || "str";
  const baseStat = baseStatKey === "int" ? I : baseStatKey === "dex" ? D : S;

  // 空手倍率 ×1
  const mult = wt ? cfg.mult : 1;

  // ATK
  const atk = Math.round(baseStat * mult);

  // 傷害浮動：INT 每點縮小下限 0.01（上限收窄到 0.9），最低下限 0.5
  const dmgMin = Math.min(0.9, 0.5 + I * 0.01);
  const dmgMax = 1.3;

  // 盾牌 +20%；雙手劍 +10%
  // 劍士：單手劍+盾再 +20%，雙手劍再 +5%
  // 軍師：單手劍+盾再 +20%
  const hasShield = !!offhand && offhand.equipSlot === "shield" && !isDualWield;
  const hasSwordsmanBlock = hasSwordsmanBadge && (wt === "sword_1h" || wt === "sword_2h");
  let blockChance = 0;
  if (hasShield) blockChance += 20;
  if (wt === "sword_2h") blockChance += 10;
  if (hasSwordsmanBadge && hasShield && wt === "sword_1h") blockChance += 20;
  if (hasSwordsmanBadge && wt === "sword_2h") blockChance += 5;
  if (hasTacticianBadge && hasShield && wt === "sword_1h") blockChance += 20;
  const blockCounter  = (hasShield && wt === "sword_1h") || (hasSwordsmanBlock && wt === "sword_2h");

  const stunChance = cfg.stunChance ?? 0;
  const armorBreakChance = cfg.armorBreak ?? 0;

  const counterChance = isDualWield ? (DUAL_COUNTER_CHANCE[wt] ?? 0) : 0;
  // 劍和匕首雙持時繼承擊暈/破防；槌/斧不繼承
  const counterInheritStun  = isDualWield && (wt === "sword_1h" || wt === "dagger");
  const counterInheritBreak = isDualWield && (wt === "sword_1h" || wt === "dagger");

  // 矮人戰士：高血量時擊暈加成（需拿槌子，HP 門檻由戰鬥流程判斷）
  let dwarfWarriorHighHpStunBoost = 0;
  if (hasDwarfWarriorBadge && wt && wt.startsWith("mace")) {
    dwarfWarriorHighHpStunBoost = 10;
  }

  let dwarfWarriorBonusVsStunnedPct = 0;
  if (hasDwarfWarriorBadge && wt === "mace_1h") {
    dwarfWarriorBonusVsStunnedPct = 15;
  } else if (hasDwarfWarriorBadge && wt === "mace_2h") {
    dwarfWarriorBonusVsStunnedPct = 25;
  }

  const baseStats = {
    // 原始總屬性（含裝備），提供戰鬥流程與外部邏輯直接使用
    str: S,
    agi: A,
    vit: V,
    int: I,
    dex: D,
    luk: L,

    // 基礎數值
    maxHp:    V * 15 + 50,
    atk,
    dmgMin,
    dmgMax,
    def:      Math.min(75, vit * 2),
    dodge:    Math.min(50, A * 0.5) + (cfg.dodgeBonus ?? 0) + tierSetBonuses.dodgePct,
    hit:      Math.min(100, 70 + D) + tierSetBonuses.hitPct,
    crit:     Math.min(100, L * 0.3 + (cfg.critBonus ?? 0)) + tierSetBonuses.critRatePct,
    combo:    Math.min(80, 3 + A * 0.5 + (cfg.comboBonus ?? 0)),
    comboDamageMultiplier: 1,
    tierSetBonuses,
    tierDamageMultiplier: 1 + tierSetBonuses.damagePct / 100,
    tierFinalDamageMultiplier: 1 + tierSetBonuses.finalDamagePct / 100,
    tierBossDamageMultiplier: (1 + tierSetBonuses.bossDamagePct / 100) * (1 + getBossBoostPct(pkRating ?? 0) / 100),
    tierCritDamageMultiplier: 1 + tierSetBonuses.critDamagePct / 100,
    executeChance: 0,
    executeThresholdPct: 0,

    // 武器特效
    weaponType:        wt,
    isTwoHanded:       cfg.isTwoHanded ?? false,
    isDualWield,
    bypassMonsterDefPct: cfg.bypassDefPct ?? 0,
    monsterAttackCount:cfg.monsterAtk ?? 1,
    stunChance,
    stunDuration: cfg.stunDuration ?? 3,
    armorBreakChance,

    // 盾牌
    blockChance,
    blockCounter,

    // 雙持
    counterChance,
    counterInheritStun,
    counterInheritBreak,

    // 矮人戰士
    hasDwarfWarriorBadge,
    dwarfWarriorHighHpStunBoost,
    dwarfWarriorBonusVsStunnedPct,
  };

  const effectContext = { equipped, inventory };
  const equipmentEffects = collectEquipmentEffects(equipped, "passive", effectContext);
  const combinedEffects = [...equipmentEffects, ...(Array.isArray(activeEffects) ? activeEffects : [])];
  const nextStats = applyEffectsToStats(baseStats, combinedEffects, effectContext);

  nextStats.def = Math.min(75, Math.max(0, Number(nextStats.def) || 0));
  nextStats.dodge = Math.min(95, Math.max(0, Number(nextStats.dodge) || 0));
  nextStats.hit = Math.min(100, Math.max(0, Number(nextStats.hit) || 0));
  nextStats.crit = Math.min(100, Math.max(0, Number(nextStats.crit) || 0));
  nextStats.blockChance = Math.min(95, Math.max(0, Number(nextStats.blockChance) || 0));
  nextStats.comboDamageMultiplier = Math.max(0.1, Number(nextStats.comboDamageMultiplier) || 1);
  nextStats.executeChance = Math.min(100, Math.max(0, Number(nextStats.executeChance) || 0));
  nextStats.executeThresholdPct = Math.min(100, Math.max(0, Number(nextStats.executeThresholdPct) || 0));
  nextStats.atk = Math.max(1, Math.round(Number(nextStats.atk) || baseStats.atk));
  nextStats.maxHp = Math.max(1, Math.round(Number(nextStats.maxHp) || baseStats.maxHp));

  return nextStats;
}

function getEquippedTierSet(progressOrEquipped = {}) {
  const equipped = progressOrEquipped?.equipment && typeof progressOrEquipped.equipment === "object"
    ? progressOrEquipped.equipment
    : progressOrEquipped;
  if (!equipped || typeof equipped !== "object") return new Set();

  const tiers = new Set();
  for (const slot of EQUIPPED_TIER_SLOTS) {
    const item = equipped[slot];
    const tier = String(item?.tier || "").toUpperCase();
    if (tier) tiers.add(tier);
  }
  return tiers;
}

function isOnlyDTierEquipped(progressOrEquipped = {}) {
  const tiers = getEquippedTierSet(progressOrEquipped);
  return tiers.size > 0 && tiers.size === 1 && tiers.has("D");
}

function getWeaponConfig(weaponType) {
  return WEAPON_CONFIG[weaponType] ? { ...WEAPON_CONFIG[weaponType] } : null;
}

module.exports = { calcPlayerStats, isOnlyDTierEquipped, getWeaponConfig, WEAPON_CONFIG };
