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
// stunChance  : 擊暈機率%（擊暈後怪物3回合無法攻擊）
// armorBreak  : 破防%（此次攻擊無視怪物 DEF%）
// monsterAtk  : 怪物每回合攻擊次數（倍數，預設1）
// bypassDefPct: 無視怪物 DEF 的百分比（0~100，法杖專用，50=無視一半）
// counterChance: 雙持副手追擊機率%（怪物攻擊後觸發）
// counterStun : 副手追擊是否繼承擊暈機率
// counterBreak: 副手追擊是否繼承破防
// ─────────────────────────────────────────────
const WEAPON_CONFIG = {
  sword_1h: { mult: 4 },
  sword_2h: { mult: 5, isTwoHanded: true },
  mace_1h:  { mult: 3, stunChance: 20 },
  mace_2h:  { mult: 4, isTwoHanded: true, stunChance: 30 },
  axe_1h:   { mult: 3, armorBreak: 15, critBonus: 10 },
  axe_2h:   { mult: 5, isTwoHanded: true, armorBreak: 15, critBonus: 20 },
  dagger:   { mult: 2, comboBonus: 20 },
  staff_1h: { mult: 3, baseStat: "int", monsterAtk: 2, bypassDefPct: 15 },
  staff_2h: { mult: 4, baseStat: "int", isTwoHanded: true, monsterAtk: 2, bypassDefPct: 25 },
  bow:      { mult: 4, baseStat: "dex", isTwoHanded: true, dodgeBonus: 20 },
};

// 副手武器種類（可雙持）
const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);
const EQUIPPED_TIER_SLOTS = TIER_SET_SLOTS;

// 雙持時主手不同武器的副手追擊機率
// staff_1h：副手觸發但傷害為 0，僅用於觸發法師 proc 效果（燒傷/麻痺/冰凍）
const DUAL_COUNTER_CHANCE = {
  sword_1h: 20,
  mace_1h:  20,
  axe_1h:   20,
  dagger:   40,
  staff_1h: 20,
};

/**
 * 依玩家基礎屬性與已裝備物品計算戰鬥數值。
 * monsterZoneHandlers 與 playerAppRoutes 共用此函式。
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

  // 盾格擋：盾牌本身 20%
  // 雙手劍格擋：雙手劍本身 10%
  // 劍士額外加成：單手劍+盾再 +20%，雙手劍再 +10%
  const hasShield = !!offhand && offhand.equipSlot === "shield" && !isDualWield;
  const hasSwordsmanBlock = hasSwordsmanBadge && (wt === "sword_1h" || wt === "sword_2h");
  let blockChance = 0;
  if (hasShield) blockChance += 20;
  if (wt === "sword_2h") blockChance += 10;
  if (hasSwordsmanBadge && hasShield && wt === "sword_1h") blockChance += 20;
  if (hasSwordsmanBadge && wt === "sword_2h") blockChance += 10;
  const blockCounter  = (hasShield && wt === "sword_1h") || (hasSwordsmanBlock && wt === "sword_2h");

  // 擊暈機率（槌類）
  const stunChance = cfg.stunChance ?? 0;

  // 破防機率（斧類，此回合無視怪物DEF%）
  const armorBreakChance = cfg.armorBreak ?? 0;

  // 副手追擊（雙持時，怪物攻擊後觸發）
  const counterChance = isDualWield ? (DUAL_COUNTER_CHANCE[wt] ?? 0) : 0;
  // 法杖雙持：副手只觸發 proc，傷害固定為 0
  const counterIsStaffProc = isDualWield && wt === "staff_1h";
  // 副手追擊繼承擊暈/破防：劍和匕首繼承，槌/斧不繼承
  const counterInheritStun  = isDualWield && (wt === "sword_1h" || wt === "dagger");
  const counterInheritBreak = isDualWield && (wt === "sword_1h" || wt === "dagger");

  // 弓箭手：命中要害機制（DEX 驅動）
  let archerCritRate = 0;
  let archerCritMultiplier = 1.5;
  if (hasArcherBadge && wt === "bow") {
    archerCritRate = Math.min(80, 35 + D * 0.45);
  }

  // 弓：閃躲後追擊機制
  let bowDodgeCounterCritRate = 5;   // 基礎 5%
  let bowDodgeCounterCritMultiplier = 1.2;  // 基礎 1.2 倍
  if (hasArcherBadge && wt === "bow") {
    // 弓箭手徽章強化：提升至 35% 和 1.5 倍
    bowDodgeCounterCritRate = 35;
    bowDodgeCounterCritMultiplier = 1.5;
  }

  // 劍士：格擋反擊準度加成
  let swordsmanBlockCritBoost = 0;
  if (hasSwordsmanBadge && (wt === "sword_1h" || wt === "sword_2h") && blockChance > 0) {
    // 劍士格擋反擊命中率 +20%
    swordsmanBlockCritBoost = 20;
  }

  // 戰士：低血量傷害倍增（<35%）
  let warriorLowHpMultiplier = 1;
  // 在 combatLoop 中根據當前 HP 計算

  // 矮人戰士：高血量擊暈加成（>85%，需拿槌子）
  let dwarfWarriorHighHpStunBoost = 0;
  if (hasDwarfWarriorBadge && wt && wt.startsWith("mace")) {
    dwarfWarriorHighHpStunBoost = 10;
  }

  // 矮人戰士：對暈眩目標增傷
  let dwarfWarriorBonusVsStunnedPct = 0;
  if (hasDwarfWarriorBadge && wt === "mace_1h") {
    dwarfWarriorBonusVsStunnedPct = 15;
  } else if (hasDwarfWarriorBadge && wt === "mace_2h") {
    dwarfWarriorBonusVsStunnedPct = 25;
  }

  // 盜賊：連擊速度倍增
  let rogueComboSpeedBoost = 0;
  if (hasRogueBadge && wt === "dagger") {
    // 匕首時連擊倍率 +30%
    rogueComboSpeedBoost = 0.3;
  }

  // 法師：法杖傷害倍率
  let mageDamageMultiplier = 1;
  if (hasMageBadge && wt && wt.startsWith("staff")) {
    mageDamageMultiplier = 1.15;  // 法杖傷害 +15%
  }

  // 治療師：不參與直接戰鬥傷害，但有 aura 加成
  let healerAuraActive = hasHealerBadge;

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
    dmgMin,   // 傷害浮動下限（顯示用）
    dmgMax,   // 傷害浮動上限
    def:      Math.min(75, vit * 2),       // 百分比減傷 0~75%（僅基礎 VIT，裝備 VIT 不計入防禦）
    dodge:    Math.min(50, A * 0.5) + (cfg.dodgeBonus ?? 0) + tierSetBonuses.dodgePct, // 弓+30%，上限不強制（弓本來就特殊）
    hit:      Math.min(100, 70 + D) + tierSetBonuses.hitPct,       // 基礎70，DEX每點+1
    crit:     Math.min(100, L * 0.3 + (cfg.critBonus ?? 0)) + tierSetBonuses.critRatePct, // LUK → 爆擊%，斧+10/20%
    combo:    Math.min(80, 3 + A * 0.5 + (cfg.comboBonus ?? 0)), // AGI×0.5，匕首+20%
    comboDamageMultiplier: 1,                    // 連擊傷害倍率
    tierSetBonuses,
    tierDamageMultiplier: 1 + tierSetBonuses.damagePct / 100,
    tierFinalDamageMultiplier: 1 + tierSetBonuses.finalDamagePct / 100,
    tierBossDamageMultiplier: (1 + tierSetBonuses.bossDamagePct / 100) * (1 + getBossBoostPct(pkRating ?? PK_RATING_DEFAULT) / 100),
    tierCritDamageMultiplier: 1 + tierSetBonuses.critDamagePct / 100,
    executeChance: 0,                            // 斬殺觸發率
    executeThresholdPct: 0,                      // 斬殺門檻血量%

    // 武器特效
    weaponType:        wt,
    isTwoHanded:       cfg.isTwoHanded ?? false,
    isDualWield,
    bypassMonsterDefPct: cfg.bypassDefPct ?? 0,    // 法杖：無視怪物DEF的百分比（50=無視一半）
    monsterAttackCount:cfg.monsterAtk ?? 1,       // 法杖：怪物攻擊×2
    stunChance,                                    // 槌：擊暈機率%
    armorBreakChance,                              // 斧：破防機率%

    // 盾牌
    blockChance,     // 盾格擋機率%
    blockCounter,    // 單手劍+盾：格擋後反擊

    // 雙持
    counterChance,         // 副手追擊機率%
    counterInheritStun,    // 副手繼承擊暈
    counterInheritBreak,   // 副手繼承破防
    counterIsStaffProc,    // 法杖雙持：副手觸發 proc 但傷害為 0

    // 職業特效
    // 弓箭手
    hasArcherBadge,
    archerBowDamageBoost: hasArcherBadge && wt === "bow" ? 1.2 : 1,
    archerCritRate,
    archerCritMultiplier,
    archerDodgeCounterActive: false,
    bowDodgeCounterCritRate,
    bowDodgeCounterCritMultiplier,

    // 劍士
    hasSwordsmanBadge,
    swordsmanBlockCritBoost,     // 格擋反擊命中率加成
    blockCounterDamageMultiplier: 1,  // 反擊傷害倍率

    // 戰士
    hasWarriorBadge,
    warriorLowHpMultiplier,   // 低血量傷害倍增
    warriorCritDamageBonus: (hasWarriorBadge && wt === "axe_2h") ? 0.2 : 0,  // 雙手斧爆擊傷害 +0.2x

    // 矮人戰士
    hasDwarfWarriorBadge,
    dwarfWarriorHighHpStunBoost,     // 高血量擊暈加成
    dwarfWarriorBonusVsStunnedPct,    // 對暈眩目標增傷

    // 盜賊
    hasRogueBadge,
    rogueComboSpeedBoost,     // 連擊速度倍增

    // 法師
    hasMageBadge,
    mageDamageMultiplier,     // 法杖傷害倍率

    // 治療師
    hasHealerBadge,
    healerAuraActive,         // 是否有治療光環

    // 軍師
    hasTacticianBadge,

    // 詩人
    hasBardBadge,

    // 結界師
    hasBarrierMageBadge,
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

module.exports = { calcPlayerStats, getEquippedTierSet, isOnlyDTierEquipped };
