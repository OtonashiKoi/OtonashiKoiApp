"use strict";

const ATK_MULT_1H   = 3;
const ATK_MULT_DUAL = 2;

// 各武器種類的特殊配置（省略欄位代表使用預設值）
const WEAPON_CONFIG = {
  dagger:   { mult: 2, comboBonus: 20 },            // 匕首：×2，連擊+20%
  axe_2h:   { mult: 4 },                            // 雙手斧：×4
  staff_1h: { mult: 4, monsterAtk: 2, absoluteHit: true }, // 法杖：×4，怪物攻擊×2，絕對命中
  staff_2h: { mult: 5, monsterAtk: 2, absoluteHit: true }, // 雙手法杖：×5，怪物攻擊×2，絕對命中
};

/**
 * 依玩家基礎屬性與已裝備物品計算戰鬥數值。
 * monsterZoneHandlers 與 playerPanel 共用此函式，確保數值一致。
 */
function calcPlayerStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = {}, equipped = {}) {
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

  const weapon      = equipped.weapon || null;
  const offhand     = equipped.shield || null;
  const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);
  const isDualWield = weapon && !weapon.isTwoHanded && offhand?.weaponType != null && OFFHAND_WEAPON_TYPES.has(offhand.weaponType);
  const wt  = weapon?.weaponType;
  const cfg = WEAPON_CONFIG[wt] || {};
  const mult        = isDualWield ? ATK_MULT_DUAL : (cfg.mult ?? ATK_MULT_1H);
  const attackCount = isDualWield ? 2 : 1;

  let baseStat;
  if (!wt)                                         baseStat = S; // 徒手 → STR
  else if (wt === "staff_1h" || wt === "staff_2h") baseStat = I; // 法杖 → INT
  else if (wt === "bow")                           baseStat = D; // 弓 → DEX
  else                                             baseStat = S; // 劍/斧/錘/匕首 → STR

  return {
    maxHp:              V * 15 + 50,
    atk:                Math.round(baseStat * mult),
    attackCount,
    monsterAttackCount: cfg.monsterAtk ?? 1,        // 法杖裝備者每回合受兩次攻擊
    def:                V,                           // VIT（含裝備加成）= 防禦
    dodge:              Math.min(50,  A * 0.5),
    hit:                cfg.absoluteHit ? 100 : Math.min(100, 80 + D), // 法杖絕對命中
    crit:               Math.min(100, L * 0.3),      // LUK → 爆擊%
    combo:              Math.min(80,  3 + A * 0.3 + (cfg.comboBonus ?? 0)), // 匕首+20%
    weaponType:         wt || null
  };
}

module.exports = { calcPlayerStats };
