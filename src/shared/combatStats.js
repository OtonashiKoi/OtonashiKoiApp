"use strict";
const { collectEquipmentEffects, applyEffectsToStats } = require("./effectEngine");
const { getEquipmentTierSetBonuses, TIER_SET_SLOTS } = require("./equipmentTierSetBonuses");
const { getSetNumericBonuses } = require("./equipmentSetBonuses");
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
  // 斧（V0.5 武器身分）：高傷爆擊、代價是命中低（可用 DEX 配點/命中裝繞過）。
  // 破防(armorBreak)已依使用者定案整個拿掉（2026-08-07 實裝）——斧的身分只剩「重擊與揮空」。
  axe_1h:   { mult: 3, critBonus: 10, hitPenalty: 10 },
  axe_2h:   { mult: 5, isTwoHanded: true, critBonus: 20, hitPenalty: 20 },
  // 匕首（2026-08-03 下季平衡，兩刀）：
  //   mult 3→2→3：2026-08-07 使用者定案改回 3——B37 影舞者下修（毒/影襲移除）疊上 mult 2
  //   把匕首系砍到頂輸出的 50%（影舞者 17,358、盜賊 14,946，同世界頂點 34,375），矯枉過正。
  //   comboBonus 20→10：真實玩家條件（隨機配點、AGI~20）下，這個不吃屬性的固定加成
  //   是盜賊輸出 173% 的單一最大來源——攻擊次數是乘法結構，+20% 次數放大所有其他加成。
  dagger:   { mult: 3, baseStat: "agi", comboBonus: 10 },
  staff_1h: { mult: 3, baseStat: "int", bypassDefPct: 15 },
  staff_2h: { mult: 4, baseStat: "int", isTwoHanded: true, bypassDefPct: 25 },
  bow:      { mult: 4, baseStat: "dex", isTwoHanded: true, dodgeBonus: 20 },
  // 骰子：全遊戲唯一以 LUK 為攻擊屬性的武器（賭徒本命），雙手武器。
  // LUK 本身已有三重收益（爆擊率 ×0.5、攻擊擲骰階級、防禦擲骰階級），
  // 所以不給 critBonus——爆擊率完全由玩家自己堆的 LUK 決定。
  // attackSegments：每回合固定攻擊 N 段（倍率已對半），每段各自擲爆擊/攻擊階級，不計入連擊。
  // faceMultipliers：每段各擲一顆 d6，骰面決定該段傷害倍率（純運氣、不看屬性）。
  //   平均 (0.5+0.75+1+1+1.25+1.5)/6 = 1.0 → 不影響整體平衡，只放大方差。
  //   骰面在攻擊一開始就全部擲出，命中/迴避對整輪只判定一次（迴避＝兩擲一起被閃）。
  // allMinMult / allMaxMult：全 1 / 全 6（雙骰各 1/36）時，把每段倍率改寫成這個值。
  //   全 1 → 每段 0.5，整輪＝基準的 50%（與骰面原值相同，寫出來讓規則明確）。
  //   全 6 → 每段 2.5，整輪＝基準的 250%。
  dice: {
    mult: 1.5,
    baseStat: "luk",
    isTwoHanded: true,
    attackSegments: 2,
    faceMultipliers: [0.5, 0.75, 1.0, 1.0, 1.25, 1.5],
    allMinMult: 0.5,
    allMaxMult: 2.5,
    // 魔法傷害判定（使用者定案 2026-07-24）：骰子傷害視為魔法——常駐無視 25% DEF，
    // 與雙手法杖同級（賭徒線 2026-08-07 使用者定案下季開放：試煉已 enabled、骰子已入各階掉落表）
    bypassDefPct: 25,
  },
};

// 副手武器種類（可雙持）
const OFFHAND_WEAPON_TYPES = new Set(["offhand_sword", "offhand_dagger", "offhand_mace"]);
const EQUIPPED_TIER_SLOTS = TIER_SET_SLOTS;

// 雙持副手追擊機制已移除（2026-05-26）

/**
 * 依玩家基礎屬性與已裝備物品計算戰鬥數值。
 */
function calcPlayerStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1, luk = 1 } = {}, equipped = {}, activeEffects = [], inventory = [], { pkRating, zone = null, petStat = 0 } = {}) {
  // 🐾寵物圖鑑收集里程碑：全屬性 +N（當作基礎屬性加成，驅動所有衍生數值）
  const _petStat = Math.max(0, Number(petStat) || 0);
  const tierSetBonuses = getEquipmentTierSetBonuses(equipped);
  // 併入具名套裝(秘銀/火焰…)的數值加成，讓下游倍率與顯示一併吃到
  const _setNumeric = getSetNumericBonuses(equipped);
  tierSetBonuses.stats.str += _setNumeric.stats.str;
  tierSetBonuses.stats.int += _setNumeric.stats.int;
  tierSetBonuses.stats.dex += _setNumeric.stats.dex;
  for (const _k of ["hitPct", "dodgePct", "critRatePct", "critDamagePct", "damagePct", "finalDamagePct", "bossDamagePct", "goldPct", "expPct", "dropPct"]) {
    tierSetBonuses[_k] += _setNumeric[_k];
  }

  // 裝備加成
  const bonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const item of Object.values(equipped)) {
    // 職業徽章的屬性值隨徽章等級成長（Lv1~9 半量／Lv10~19 帳面值／Lv20 超越 1.5 倍）。
    // 效果百分比（攻擊+50% 那些）不受等級影響，全程完整生效。見 shared/jobBadgeLevel.js。
    let _stats = item?.equipStats;
    if (_stats) {
      try { _stats = require("./jobBadgeLevel").effectiveStatsForEntry(item) || _stats; } catch (_) { /* 模組缺失時用原值 */ }
    }
    if (_stats) {
      for (const [k, v] of Object.entries(_stats)) {
        if (k in bonus) bonus[k] += (v || 0);
      }
    }
    // 附魔：基礎屬性詞條(力/敏/體/智/技/幸)直接加進屬性加成，自然驅動所有衍生數值。
    // （爆擊/爆傷/連擊/吸血/減傷/命中/迴避/攻擊/最大生命等衍生詞條另以專門對應處理，避免 flat/% 混淆）
    if (Array.isArray(item?.enchantments)) {
      for (const en of item.enchantments) {
        if (en && en.key in bonus) bonus[en.key] += (Number(en.value) || 0);
      }
    }
  }
  const S = str + bonus.str + tierSetBonuses.stats.str + _petStat;
  const A = agi + bonus.agi + _petStat;
  const V = vit + bonus.vit + _petStat;
  const I = INT + bonus.int + tierSetBonuses.stats.int + _petStat;
  const D = dex + bonus.dex + tierSetBonuses.stats.dex + _petStat;
  const L = luk + bonus.luk + _petStat;

  // ── 新 DEF 模型（baseVit → flat 減傷；equipVit → % 減傷） ──
  // 前 VIT（升等的）：每點 -1 固定傷害
  // 後 VIT（裝備的）：每 2 點 -1% 傷害（封頂 85%）；怪物技能傷害也吃此 def%
  const baseVit = Math.max(0, vit + _petStat); // 收集加成的 VIT 當基礎 → 給 flat 減傷
  const equipVit = Math.max(0, bonus.vit + (tierSetBonuses.stats.vit || 0));
  const flatDef = baseVit * 1;
  const pctDef = Math.min(85, equipVit / 2);

  const weapon  = equipped.weapon || null;
  const offhand = equipped.shield || null;
  const wt      = weapon?.weaponType || null;
  const cfg     = WEAPON_CONFIG[wt] || {};
  
  // 職業徽章效果檢測
  const jobEq = equipped.job_eq || null;
  const jobId = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const jobName = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
  // ⭐ 職業判定一律走 jobAdvancement.resolveJobKey（唯一入口）：
  //    一轉徽章 → 自己的 key；二轉徽章 → 它的一轉 key（自動繼承所有程式碼內建加成）。
  //    以前各檔案自己 `id.includes("swordsman") || name.includes("劍士")`，
  //    劍鬼（id swordoni／名「劍鬼」）兩個都不中 → 少了格擋反擊，實測比一轉還弱 10%。
  let _jobKey = null;
  try { _jobKey = require("./jobAdvancement").resolveJobKey(jobEq); } catch (_) { _jobKey = null; }
  const isJobKey = (k) => Boolean(jobEq) && _jobKey === k;
  const hasArcherBadge = isJobKey("archer");
  const hasSwordsmanBadge = isJobKey("swordsman");
  const hasWarriorBadge = isJobKey("warrior");
  const hasDwarfWarriorBadge = isJobKey("dwarf_warrior");
  const hasRogueBadge = isJobKey("rogue");
  const hasMageBadge = isJobKey("mage");
  const hasHealerBadge = isJobKey("healer");
  const hasTacticianBadge = isJobKey("tactician");
  const hasBardBadge = isJobKey("bard");
  const hasBarrierMageBadge = isJobKey("barrier_mage");

  // 雙持判定：主手非雙手武器 + 副手是武器類型
  const isDualWield = !cfg.isTwoHanded && wt && offhand?.weaponType != null && OFFHAND_WEAPON_TYPES.has(offhand.weaponType);

  // baseStat
  // 匕首自 V0.4 起一律吃 AGI（原本只有盜賊徽章才改吃 AGI，現統一由 WEAPON_CONFIG 決定）
  const baseStatKey = cfg.baseStat || "str";
  const baseStat = baseStatKey === "int" ? I
    : baseStatKey === "dex" ? D
      : baseStatKey === "agi" ? A
        : baseStatKey === "luk" ? L
          : S;

  // 空手倍率 ×1
  const mult = wt ? cfg.mult : 1;

  // ATK
  const atk = Math.round(baseStat * mult);

  // 傷害浮動：0.7 ~ 1.0；INT 每點 +0.01 抬高下限（最多 INT=30 達 1.0 恆定不浮動）
  const dmgMin = Math.min(1.0, 0.7 + I * 0.01);
  const dmgMax = 1.0;

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

  // 副手追擊已移除：保留 isDualWield 旗標供 hasShield 判定，但不再產生追擊
  const counterChance = 0;
  const counterInheritStun = false;
  const counterInheritBreak = false;

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
    // G1（V0.5 生存地基・2026-08-01 賽季空窗實裝）：VIT×15+50 → VIT×25+200。
    // 舊制 Lv50 標配血池 575 vs 終局王每回合承傷 546（差 14.4 倍不可能活滿 15 回合），
    // 全設計反推見 docs/SEASON_NEXT_SURVIVAL_15R_DESIGN.md。
    maxHp:    V * 25 + 200,
    atk,
    weaponMainStat: baseStatKey,       // 武器主屬性名稱(str/int/dex)
    weaponMainStatValue: baseStat,     // 武器主屬性數值(用於終傷後追加固定傷害)
    dmgMin,
    dmgMax,
    // ── DEF 新模型 ──
    // def  保留為「百分比減傷」的欄位（既有 Buff/Debuff 都改它），= pctDef
    // flatDef 是純減固定值（從升等加的 base VIT 來）
    def:      pctDef,
    flatDef,
    baseVit,
    equipVit,
    dodge:    Math.min(50, A * 0.5) + (cfg.dodgeBonus ?? 0) + tierSetBonuses.dodgePct,
    hit:      Math.min(100, 70 + D) - (cfg.hitPenalty ?? 0) + tierSetBonuses.hitPct, // 命中基礎維持 70+DEX；斧扣 hitPenalty(V0.5 武器身分)；命中曲線改由 hitChance 常數(75→62)+各區迴避帶驅動
    crit:     Math.min(100, L * 0.5 + (cfg.critBonus ?? 0)) + tierSetBonuses.critRatePct, // LUK 每點爆擊 0.3→0.5(V0.4 平衡:LUK 補值)
    // 連擊率上限：全職業統一封頂 100%（2026-08-03）。
    // 舊制是「非盜賊 80%、盜賊不設上限」——不設上限讓盜賊的攻擊次數隨 AGI 無限成長，
    // 而攻擊次數是乘法結構（次數 ×2 → 爆擊/附魔/屬性的效益全部 ×2），高等時會失控。
    combo:    Math.min(100, 3 + A * 0.5 + (cfg.comboBonus ?? 0)),
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
    attackSegments:    cfg.attackSegments ?? 1,   // 每回合固定攻擊段數（骰子＝2），不計入連擊
    faceMultipliers:   Array.isArray(cfg.faceMultipliers) ? cfg.faceMultipliers : null, // d6 骰面傷害倍率
    allMinMult:        cfg.allMinMult ?? null,    // 全骰面皆為 1 時，每段改用此倍率
    allMaxMult:        cfg.allMaxMult ?? null,    // 全骰面皆為最大值時，每段改用此倍率
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

    // 盜賊（連擊率可破 100%）
    hasRogueBadge,

    // 矮人戰士
    hasDwarfWarriorBadge,
    dwarfWarriorHighHpStunBoost,
    dwarfWarriorBonusVsStunnedPct,
  };

  const effectContext = { equipped, inventory, zone };
  // 裝備 passive 效果（已含附魔衍生詞條——collectEffectRefsFromEntry 會把 entry.enchantments 轉成效果）
  const equipmentEffects = collectEquipmentEffects(equipped, "passive", effectContext);
  const combinedEffects = [...equipmentEffects, ...(Array.isArray(activeEffects) ? activeEffects : [])];
  const nextStats = applyEffectsToStats(baseStats, combinedEffects, effectContext);

  // ── 基礎屬性 buff 的衍生值重推導 ──────────────────────────────────────
  // baseStats 在上面就已經把 atk / crit / dodge / combo / maxHp / hit 等「由基礎屬性推導的值」算死了，
  // 而 applyEffectsToStats 只會去加 nextStats.agi / nextStats.luk 這類「已經被用完的原始屬性」。
  // 結果是戰鬥中的 str_up / agi_up / luk_up 等效果只改面板數字，對 ATK、爆擊率完全無效
  // （例：詩人「激昂旋律」的 AGI+8 對匕首系的 ATK 一直是沒作用的）。
  // 這裡用「屬性差值」補推導：只補 buff 造成的增量，不重算整體，
  // 才不會跟 applyEffectsToStats 已處理的 crit_rate_up / dodge_up / combo_up 重複計算。
  {
    const before = { str: S, agi: A, vit: V, int: I, dex: D, luk: L };
    const d = {};
    let changed = false;
    for (const k of ["str", "agi", "vit", "int", "dex", "luk"]) {
      d[k] = (Number(nextStats[k]) || 0) - before[k];
      if (d[k] !== 0) changed = true;
    }
    if (changed) {
      // ATK：武器主屬性的增量 × 武器倍率
      const dMain = d[baseStatKey] || 0;
      if (dMain !== 0) {
        nextStats.atk = (Number(nextStats.atk) || 0) + Math.round(dMain * mult);
        // 武器主屬性追加傷害（終傷後 +主屬性×1.5）也要跟著動
        nextStats.weaponMainStatValue = Math.max(0, (Number(nextStats.weaponMainStatValue) || 0) + dMain);
      }
      if (d.luk !== 0) nextStats.crit = (Number(nextStats.crit) || 0) + d.luk * 0.5;
      if (d.agi !== 0) {
        nextStats.dodge = (Number(nextStats.dodge) || 0) + d.agi * 0.5;
        nextStats.combo = (Number(nextStats.combo) || 0) + d.agi * 0.5;
      }
      if (d.vit !== 0) nextStats.maxHp = (Number(nextStats.maxHp) || 0) + d.vit * 15;
      if (d.dex !== 0) nextStats.hit = (Number(nextStats.hit) || 0) + d.dex;
    }
  }

  nextStats.def = Math.min(85, Math.max(0, Number(nextStats.def) || 0));
  nextStats.flatDef = Math.max(0, Number(nextStats.flatDef) || 0);
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

// ─────────────────────────────────────────────────────────────────────────
// 攻擊階級擲骰系統（5 階）
//   大失敗 → 自殘 30%、跳出
//   失敗   → 強制 miss、跳出
//   成功   → ×1.0，看閃避
//   大成功 → ×1.3，必中
//   完美   → 走爆擊 ×2、必中
//
// 基準機率 5 / 10 / 65 / 15 / 5
// DEX：大失敗 −0.025% / 失敗 −0.05% / 大成功 +0.075%
// LUK：大失敗 −0.05% / 大成功 +0.05%
// 完美 固定 5%（不受屬性影響）
// ─────────────────────────────────────────────────────────────────────────
const ATTACK_TIER_BASE = { critFail: 5, fail: 10, success: 65, great: 15, perfect: 5 };
function calcAttackTierProbs(dex = 0, luk = 0) {
  const d = Math.max(0, dex), l = Math.max(0, luk);
  let critFail = Math.max(0, ATTACK_TIER_BASE.critFail - d * 0.025 - l * 0.05);
  let fail = Math.max(0, ATTACK_TIER_BASE.fail - d * 0.05);
  let great = ATTACK_TIER_BASE.great + d * 0.075 + l * 0.05;
  const perfect = ATTACK_TIER_BASE.perfect;
  let success = 100 - critFail - fail - great - perfect;
  if (success < 0) { great += success; success = 0; }
  return { critFail, fail, success, great, perfect };
}

// ─────────────────────────────────────────────────────────────────────────
// 防禦階級擲骰系統（4 階）
//   被爆打 → ×1.3
//   被打   → ×1.0
//   減傷   → ×0.7
//   擦傷   → ×0.3
//
// 基準機率 5 / 77 / 15 / 3
// DEX：被爆打 −0.025% / 減傷 +0.075%
// LUK：被爆打 −0.05% / 減傷 +0.05% / 擦傷 +0.0333%
// 被爆打 不低於 3%；擦傷 不高於 5%
// ─────────────────────────────────────────────────────────────────────────
const DEFENSE_TIER_BASE = { crushed: 5, hit: 77, reduce: 15, graze: 3 };
function calcDefenseTierProbs(dex = 0, luk = 0) {
  const d = Math.max(0, dex), l = Math.max(0, luk);
  const crushed = Math.max(3, DEFENSE_TIER_BASE.crushed - d * 0.025 - l * 0.05);
  let reduce = DEFENSE_TIER_BASE.reduce + d * 0.075 + l * 0.05;
  const graze = Math.min(5, DEFENSE_TIER_BASE.graze + l * 0.0333);
  let hit = 100 - crushed - reduce - graze;
  if (hit < 0) { reduce += hit; hit = 0; }
  return { crushed, hit, reduce, graze };
}

// 擲骰：依機率分布回傳階級 key
function rollAttackTier(probs) {
  const r = Math.random() * 100;
  let acc = 0;
  for (const key of ["critFail", "fail", "success", "great", "perfect"]) {
    acc += probs[key];
    if (r < acc) return key;
  }
  return "success";
}
function rollDefenseTier(probs) {
  const r = Math.random() * 100;
  let acc = 0;
  for (const key of ["crushed", "hit", "reduce", "graze"]) {
    acc += probs[key];
    if (r < acc) return key;
  }
  return "hit";
}

// 階級對應乘數
const ATTACK_TIER_MULT = { critFail: 0, fail: 0, success: 1.0, great: 1.3, perfect: 1.0 /* perfect 走爆擊分支另算 */ };
const DEFENSE_TIER_MULT = { crushed: 1.3, hit: 1.0, reduce: 0.7, graze: 0.3 };

module.exports = {
  calcPlayerStats,
  isOnlyDTierEquipped,
  getWeaponConfig,
  WEAPON_CONFIG,
  calcAttackTierProbs,
  calcDefenseTierProbs,
  rollAttackTier,
  rollDefenseTier,
  ATTACK_TIER_MULT,
  DEFENSE_TIER_MULT,
};
