"use strict";

// ─────────────────────────────────────────────
// 武器設定表
// mult        : ATK 倍率
// baseStat    : 主屬性（預設 "str"）
// isTwoHanded : 是否雙手（不可配副手武器）
// comboBonus  : 連擊率加成%
// stunChance  : 擊暈機率%（擊暈後怪物3回合無法攻擊）
// armorBreak  : 破防%（此次攻擊無視怪物 DEF%）
// monsterAtk  : 怪物每回合攻擊次數（倍數，預設1）
// bypassDef   : 傷害無視怪物 DEF%（法杖專用）
// counterChance: 雙持副手追擊機率%（怪物攻擊後觸發）
// counterStun : 副手追擊是否繼承擊暈機率
// counterBreak: 副手追擊是否繼承破防
// ─────────────────────────────────────────────
const WEAPON_CONFIG = {
  sword_1h: { mult: 3 },
  sword_2h: { mult: 6, isTwoHanded: true },
  mace_1h:  { mult: 3, stunChance: 5 },
  mace_2h:  { mult: 4, isTwoHanded: true, stunChance: 10 },
  axe_1h:   { mult: 3, armorBreak: 15 },
  axe_2h:   { mult: 5, isTwoHanded: true, armorBreak: 15 },
  dagger:   { mult: 2, comboBonus: 20 },
  staff_1h: { mult: 4, baseStat: "int", monsterAtk: 2, bypassDef: true },
  staff_2h: { mult: 6, baseStat: "int", isTwoHanded: true, monsterAtk: 2, bypassDef: true },
  bow:      { mult: 5, baseStat: "dex", isTwoHanded: true, dodgeBonus: 30 },
};

// 副手武器種類（可雙持）
const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);

// 雙持時主手不同武器的副手追擊機率
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
function calcPlayerStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = {}, equipped = {}) {
  // 裝備加成
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in bonus) bonus[k] += (v || 0);
    }
  }
  const S = str + bonus.str;
  const A = agi + bonus.agi;
  const V = vit + bonus.vit;
  const I = INT + bonus.int;
  const D = dex + bonus.dex;
  const L = luk + bonus.luk;

  const weapon  = equipped.weapon || null;
  const offhand = equipped.shield || null;
  const wt      = weapon?.weaponType || null;
  const cfg     = WEAPON_CONFIG[wt] || {};

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

  // 盾格擋：裝備盾牌就有 20% 格擋機會（傷害降至1）
  // 格擋反擊：只有單手劍+盾才有（不含槌/斧）
  const hasShield = !!offhand && offhand.equipSlot === "shield" && !isDualWield;
  const blockChance   = hasShield ? 20 : 0;
  const blockCounter  = hasShield && wt === "sword_1h" ? true : false;

  // 擊暈機率（槌類）
  const stunChance = cfg.stunChance ?? 0;

  // 破防機率（斧類，此回合無視怪物DEF%）
  const armorBreakChance = cfg.armorBreak ?? 0;

  // 副手追擊（雙持時，怪物攻擊後觸發）
  const counterChance = isDualWield ? (DUAL_COUNTER_CHANCE[wt] ?? 20) : 0;
  // 副手追擊繼承擊暈/破防：劍和匕首繼承，槌/斧不繼承
  const counterInheritStun  = isDualWield && (wt === "sword_1h" || wt === "dagger");
  const counterInheritBreak = isDualWield && (wt === "sword_1h" || wt === "dagger");

  return {
    // 基礎數值
    maxHp:    V * 15 + 50,
    atk,
    dmgMin,   // 傷害浮動下限（顯示用）
    dmgMax,   // 傷害浮動上限
    def:      Math.min(75, V * 2),         // 百分比減傷 0~75%
    dodge:    Math.min(50, A * 0.5) + (cfg.dodgeBonus ?? 0), // 弓+30%，上限不強制（弓本來就特殊）
    hit:      Math.min(100, 70 + D),       // 基礎70，DEX每點+1
    crit:     Math.min(100, L * 0.3),      // LUK → 爆擊%
    combo:    Math.min(80, 3 + A * 0.5 + (cfg.comboBonus ?? 0)), // AGI×0.5，匕首+20%

    // 武器特效
    weaponType:        wt,
    isTwoHanded:       cfg.isTwoHanded ?? false,
    isDualWield,
    bypassMonsterDef:  cfg.bypassDef ?? false,   // 法杖：無視怪物DEF
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
  };
}

module.exports = { calcPlayerStats };
