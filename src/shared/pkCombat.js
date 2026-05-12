"use strict";

/**
 * PK 玩家 vs 玩家戰鬥引擎
 *
 * 雙方都走完整的攻擊邏輯（職業技能、卡片技能、DOT、Buff/Debuff、
 * 連擊、副手追擊、盾反、格擋、斬殺、低血量爆發全部生效）。
 * 每回合：先攻方出招 → 後攻方出招（若先攻方打死則提前結束）。
 */

const {
  collectEquipmentEffects,
} = require("./effectEngine");

// ── 從 combatLoop 借用純工具函式 ─────────────────────────────
// 直接 inline 以避免循環依賴（combatLoop 沒有 export 這些）
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function effectIsActive(effect, round) {
  if (!effect || !effect.key) return false;
  const duration = effect.params?.duration || {};
  if (duration.mode !== "turns") return true;
  const appliedRound = effect.appliedAt || 1;
  const endRound = appliedRound + (duration.value || 1);
  return round <= endRound;
}

function hasAnyDebuff(activeEffects = [], round = 1) {
  const DEBUFF_KEYS = new Set([
    "atk_down", "def_down", "hit_down", "hit_rate_down", "dodge_down",
    "poison", "burn", "bleed", "shock_dot", "curse_dot",
    "stun", "freeze", "silence", "slow", "blind", "charm", "dark_curse"
  ]);
  return (activeEffects || []).some(
    (e) => effectIsActive(e, round) && DEBUFF_KEYS.has(e.key)
  );
}

function addOrStackEffect(effects = [], entry = {}) {
  if (!entry || !entry.key) return effects;
  const next = [...effects];
  const stackMode = entry.stackMode || entry.params?.stackMode || "refresh";
  const idx = next.findIndex(
    (e) => e?.key === entry.key && (e.sourceType === entry.sourceType || e.sourceId === entry.sourceId)
  );
  if (idx < 0 || stackMode === "stack_instance") { next.push(entry); return next; }
  if (stackMode === "ignore") return next;
  if (stackMode === "stack_value") {
    const prev = next[idx];
    const addV = Number(entry.params?.stackAdd ?? entry.params?.value ?? 0);
    const baseV = Number(prev.params?.value ?? 0);
    const maxV  = Number(entry.params?.maxValue ?? entry.params?.maxPct ?? NaN);
    let nv = baseV + addV;
    if (Number.isFinite(maxV)) nv = nv >= 0 ? Math.min(maxV, nv) : Math.max(-Math.abs(maxV), nv);
    next[idx] = { ...prev, ...entry, params: { ...prev.params, ...entry.params, value: nv } };
    return next;
  }
  next[idx] = entry;
  return next;
}

function cleanExpiredEffects(effects = [], round = 1) {
  return effects.filter((e) => {
    if (!e || !e.key) return false;
    const dur = e.params?.duration || {};
    if (dur.mode !== "turns") return true;
    return round <= (e.appliedAt || 1) + (dur.value || 1);
  });
}

const ROUND_DAMAGE_CAP_PCT = 25;
const IMMEDIATE_HEAL_KEYS = new Set(["heal_over_time", "life_regen", "mana_regen", "on_hit_heal", "on_crit_heal"]);
const IMMEDIATE_DAMAGE_KEYS = new Set(["burn", "poison", "bleed", "lightning", "shock_dot", "curse_dot"]);
const IMMEDIATE_LOG_SUPPRESS_KEYS = new Set([...IMMEDIATE_DAMAGE_KEYS, ...IMMEDIATE_HEAL_KEYS]);

function createRoundDamageState(aStats, bStats) {
  return {
    A: {
      cap: Math.max(1, Math.floor((aStats.maxHp || 1) * ROUND_DAMAGE_CAP_PCT / 100)),
      taken: 0,
      noticeShown: false,
    },
    B: {
      cap: Math.max(1, Math.floor((bStats.maxHp || 1) * ROUND_DAMAGE_CAP_PCT / 100)),
      taken: 0,
      noticeShown: false,
    },
  };
}

function applyRoundDamageCap({ targetKey, rawDamage, roundDamageState }) {
  const state = roundDamageState?.[targetKey];
  if (!state) return { damage: Math.max(0, Math.round(rawDamage)), capped: false };

  const damage = Math.max(0, Math.round(rawDamage));
  const remaining = Math.max(0, state.cap - state.taken);
  const finalDamage = Math.min(damage, remaining);
  state.taken += finalDamage;
  const capped = finalDamage < damage;
  if (capped && !state.noticeShown) state.noticeShown = true;
  return { damage: finalDamage, capped };
}

function pushCappedNotice(log, targetName, capped) {
  if (capped) {
    log.push(`⚠️ **${targetName}** 本回合受到的總傷害已達上限（25% HP），後續傷害將被壓制！`);
  }
}

function dealImmediateSkillDamage({
  log,
  sourceName,
  skillName,
  targetName,
  targetHpRef,
  targetKey,
  roundDamageState,
  rawDamage,
  damageLabel,
}) {
  const capResult = applyRoundDamageCap({
    targetKey,
    rawDamage,
    roundDamageState,
  });
  const finalDamage = capResult.damage;
  targetHpRef.value -= finalDamage;
  log.push(`🎴 **${sourceName || targetName}** 發動【${skillName}】！對 **${targetName}** 造成 **${finalDamage}** 點${damageLabel}傷害！（${targetName} 剩 ${Math.max(0, targetHpRef.value)} HP）`);
  pushCappedNotice(log, targetName, capResult.capped);
  return finalDamage;
}

function dealImmediateSkillHeal({
  log,
  sourceName,
  skillName,
  targetName,
  targetHpRef,
  targetMaxHp,
  rawHeal,
  healLabel = "回復"
}) {
  if (!Number.isFinite(Number(rawHeal)) || Number(rawHeal) <= 0) return 0;
  const heal = Math.max(0, Math.round(Number(rawHeal)));
  targetHpRef.value = Math.min(targetMaxHp, targetHpRef.value + heal);
  log.push(`🎴 **${sourceName || targetName}** 發動【${skillName}】！${healLabel} **${heal}** HP！（${targetName} 剩 ${Math.max(0, targetHpRef.value)} HP）`);
  return heal;
}

function rollDmg(base, stats = {}) {
  const min = Number(stats.dmgMin ?? 1);
  const max = Number(stats.dmgMax ?? min);
  const roll = min + Math.random() * (max - min);
  return Math.max(1, Math.round(base * roll));
}

function resolveGuaranteedStrike({
  sourceStats,
  sourceActive = [],
  sourceName,
  targetStats,
  targetActive = [],
  targetName,
  targetHpRef,
  targetKey,
  round,
  log,
  roundDamageState,
  verbPool = COUNTER_PHRASES,
  damageLabel = "傷害",
}) {
  let atkMultiplier = Math.max(0.1, Number(sourceStats.tierDamageMultiplier) || 1);
  let critRateBonus = 0;
  let critDmgMult = Math.max(0.1, Number(sourceStats.tierCritDamageMultiplier) || 1);
  let defIgnorePct = 0;
  let finalDmgMult = Math.max(0.1, Number(sourceStats.tierFinalDamageMultiplier) || 1);

  for (const eff of sourceActive) {
    if (!eff || !effectIsActive(eff, round)) continue;
    const v = Number(eff.params?.value ?? 0);
    switch (eff.key) {
      case 'atk_up':           atkMultiplier *= (1 + Math.abs(v) / 100); break;
      case 'atk_down':         atkMultiplier *= (1 - Math.abs(v) / 100); break;
      case 'charm':
      case 'dark_curse':       atkMultiplier *= (1 - Math.abs(v) / 100); break;
      case 'final_damage_up':  finalDmgMult  *= (1 + Math.abs(v) / 100); break;
      case 'crit_rate_up':     critRateBonus += v; break;
      case 'crit_damage_up':   critDmgMult   *= (1 + Math.abs(v) / 100); break;
      case 'def_ignore':       defIgnorePct  += Math.abs(v); break;
    }
  }

  let defBonusPct = 0;
  let defDownPct = 0;
  let defFlatBonus = 0;
  let damageRedPct = 0;

  for (const eff of targetActive) {
    if (!eff || !effectIsActive(eff, round)) continue;
    const v = Number(eff.params?.value ?? 0);
    switch (eff.key) {
      case 'def_up':
        if (eff.params?.mode === 'flat') defFlatBonus += Math.abs(v);
        else defBonusPct += Math.abs(v);
        break;
      case 'def_down':       defDownPct += Math.abs(v); break;
      case 'damage_reduction': damageRedPct += Math.abs(v); break;
    }
  }

  const calcEffDef = () => {
    const combined = Math.min(100, defIgnorePct);
    return Math.min(95, Math.max(0,
      (targetStats.def * (1 + defBonusPct / 100) * (1 - defDownPct / 100) + defFlatBonus) * (1 - combined / 100)
    ));
  };

  const attackBase = Math.max(1, Math.round(sourceStats.atk * atkMultiplier * finalDmgMult));
  const finalDef = calcEffDef();
  let dmg = Math.max(1, Math.round(rollDmg(Math.max(1, Math.round(attackBase * (1 - finalDef / 100))), sourceStats)));

  const effectiveCrit = Math.min(100, (sourceStats.crit || 0) + critRateBonus);
  const isCrit = Math.random() * 100 < effectiveCrit;
  if (isCrit) {
    dmg = Math.round(rollDmg(Math.max(1, attackBase), sourceStats) * (2.5 * critDmgMult));
  }
  if (damageRedPct > 0) dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, damageRedPct) / 100)));

  const capResult = applyRoundDamageCap({
    targetKey,
    rawDamage: dmg,
    roundDamageState,
  });
  const finalDamage = capResult.damage;
  targetHpRef.value -= finalDamage;
  log.push(`⚔️ **${sourceName}** ${rand(verbPool)}，對 **${targetName}** 造成 **${finalDamage}** 點${damageLabel}！（${targetName} 剩 ${Math.max(0, targetHpRef.value)} HP）`);
  pushCappedNotice(log, targetName, capResult.capped);
  return { damage: finalDamage, crit: isCrit, killed: targetHpRef.value <= 0 };
}

// 武器描述詞（簡化版，PvP 只需基礎動作詞）
const WEAPON_PHRASES = {
  default:  ["揮拳猛擊", "飛腿踢出", "橫掃一擊", "怒拳轟擊"],
  sword_1h: ["揮劍斬擊", "劍鋒突刺", "斜斬破風", "連續快斬"],
  sword_2h: ["重劍劈落", "雙手斬下", "大開大闔地橫斬", "蓄力重劈"],
  dagger:   ["迅捷刺出", "連環割襲", "貼身突刺", "趁隙猛刺"],
  mace_1h:  ["重錘猛砸", "迴旋錘擊", "震地一擊", "猛力橫掃"],
  mace_2h:  ["巨錘轟落", "雙手錘擊", "地裂重鎚", "全力震擊"],
  axe_1h:   ["斧刃劈砍", "破甲一擊", "側身橫斬", "旋身揮砍"],
  axe_2h:   ["巨斧狂劈", "雙手劈落", "開山斬擊", "裂地重砍"],
  staff_1h: ["施展魔法", "吟唱咒語", "釋放法術", "引導魔力"],
  staff_2h: ["施展魔法", "吟唱咒語", "釋放法術", "引導魔力"],
  bow:      ["拉弓射擊", "瞄準放箭", "急速連射", "精準狙擊"],
};
const CRIT_PHRASES   = ["會心一擊", "致命一擊", "弱點命中", "完美命中", "要害洞穿"];
const DODGE_PHRASES  = ["身形一閃", "靈巧側移", "急速後撤", "俐落閃身", "錯步避開"];
const BLOCK_PHRASES  = ["以盾格擋", "舉盾抵擋", "盾牌格開", "穩穩架住", "橫盾卸力"];
const COUNTER_PHRASES= ["抓準破綻", "順勢回擊", "趁勢反撲", "借力反打", "逆勢追擊"];
const COMBO_PHRASES  = ["連擊！", "殘影連斬！", "急速追打！", "趁勢猛攻！", "流暢追擊！"];
const STUN_PHRASES   = ["被重擊擊暈", "失去平衡", "陷入眩暈", "腦中一陣空白"];

// ── 玩家出招函式 ─────────────────────────────────────────────
// 把 combatLoop 的完整玩家攻擊段封裝，對兩個玩家都適用
// 回傳: { killed: bool, atkActiveEffects, defActiveEffects }
function attackerTurn({
  atkStats,    // 攻擊方 pStats
  atkOpts,     // 攻擊方 { equipped, inventory }
  atkName,     // 攻擊方名稱
  atkHp,       // 攻擊方目前 HP（參考用，吸血回血）
  atkHpRef,    // { value: number } 參考物件，吸血時修改
  atkActive,   // 攻擊方 activeEffects（buff 來自自身卡片）
  atkTargetKey,
  defStats,    // 防守方 pStats
  defOpts,     // 防守方 { equipped, inventory }
  defName,     // 防守方名稱
  defHpRef,    // { value: number } 參考物件，受傷時修改
  defActive,   // 防守方 activeEffects（debuff 施加目標）
  defTargetKey,
  round,
  log,
  stunRoundsLeft,   // 防守方眩暈剩餘回合（攻擊時參考）
  defFrozen,        // 防守方本回合冰凍（跳過防守方的攻擊，這裡無關，只用在描述）
  roundDamageState,
}) {
  const wt = atkStats.weaponType;
  const atkVerbs = WEAPON_PHRASES[wt] || WEAPON_PHRASES.default;
  const atkSilenced = Array.isArray(atkActive) && atkActive.some((eff) => eff?.key === 'silence' && effectIsActive(eff, round));
  const defEquipContext = { equipped: defOpts?.equipped || {}, inventory: defOpts?.inventory || [] };
  const getDefEquipmentEffects = () => collectEquipmentEffects(defOpts?.equipped || {}, null, defEquipContext);
  const getDefReactionEffects = (key) => [
    ...(Array.isArray(defActive) ? defActive.filter((eff) => eff?.key === key) : []),
    ...getDefEquipmentEffects().filter((eff) => eff?.key === key),
  ];

  // ── 計算攻擊方本回合 Buff 倍率 ────────────────────────────
  let atkMultiplier = Math.max(0.1, Number(atkStats.tierDamageMultiplier) || 1);
  let critRateBonus = 0;
  let critDmgMult   = Math.max(0.1, Number(atkStats.tierCritDamageMultiplier) || 1);
  let lifestealPct  = 0;
  let defIgnorePct  = 0;
  let finalDmgMult  = Math.max(0.1, Number(atkStats.tierFinalDamageMultiplier) || 1);
  let dodgeBonus    = 0;   // 攻擊方閃避加成（格擋反擊時用）
  let hitBonus      = 0;

  for (const eff of atkActive) {
    if (!eff || !effectIsActive(eff, round)) continue;
    const v = Number(eff.params?.value ?? 0);
    switch (eff.key) {
      case 'atk_up':           atkMultiplier *= (1 + Math.abs(v) / 100); break;
      case 'atk_down':         atkMultiplier *= (1 - Math.abs(v) / 100); break;
      case 'charm':
      case 'dark_curse':       atkMultiplier *= (1 - Math.abs(v) / 100); break;
      case 'final_damage_up':  finalDmgMult  *= (1 + Math.abs(v) / 100); break;
      case 'crit_rate_up':     critRateBonus += v; break;
      case 'crit_damage_up':   critDmgMult   *= (1 + Math.abs(v) / 100); break;
      case 'lifesteal':
      case 'life_steal_strong':lifestealPct  += Math.abs(v); break;
      case 'def_ignore':       defIgnorePct  += Math.abs(v); break;
      case 'dodge_up':         dodgeBonus    += Math.abs(v); break;
      case 'agi_up':           dodgeBonus    += Math.abs(v) * 0.5; break;
      case 'hit_up':           hitBonus      += Math.abs(v); break;
    }
  }

  // 防守方 DEF 調整（debuff）
  let defBonusPct  = 0;
  let defDownPct   = 0;
  let defFlatBonus = 0;
  let damageRedPct = 0;
  let defDodgeBonus= 0;

  for (const eff of defActive) {
    if (!eff || !effectIsActive(eff, round)) continue;
    const v = Number(eff.params?.value ?? 0);
    switch (eff.key) {
      case 'def_up':
        if (eff.params?.mode === 'flat') defFlatBonus += Math.abs(v);
        else defBonusPct += Math.abs(v);
        break;
      case 'def_down':       defDownPct   += Math.abs(v); break;
      case 'damage_reduction': damageRedPct += Math.abs(v); break;
      case 'dodge_up':       defDodgeBonus += Math.abs(v); break;
      case 'agi_up':         defDodgeBonus += Math.abs(v) * 0.5; break;
    }
  }

  // 有效防禦（百分比減傷）
  const calcEffDef = (monsterDefIgnorePct = 0) => {
    const combined = Math.min(100, defIgnorePct + monsterDefIgnorePct);
    return Math.min(95, Math.max(0,
      (defStats.def * (1 + defBonusPct / 100) * (1 - defDownPct / 100) + defFlatBonus) * (1 - combined / 100)
    ));
  };

  // 攻擊傷害浮動
  const rollDmg = (base) => {
    const roll = atkStats.dmgMin + Math.random() * (atkStats.dmgMax - atkStats.dmgMin);
    return Math.max(1, Math.round(base * roll));
  };

  // 閃避判定
  const effectiveHit = Math.min(100, atkStats.hit + hitBonus);
  const effectiveDodge = Math.min(95, defStats.dodge + defDodgeBonus);
  const hitChance = effectiveHit - effectiveDodge;

  let killed = false;

  if (stunRoundsLeft <= 0 && Math.random() * 100 >= hitChance) {
    // 閃避
    log.push(`💨 **${atkName}** 出手，**${defName}** ${rand(DODGE_PHRASES)}，躲過了攻擊！`);

    const evadeCounterEffects = getDefReactionEffects('counter_on_dodge');
    if (evadeCounterEffects.length > 0) {
      const counterEff = evadeCounterEffects[0];
      const counterChance = Number(counterEff.params?.value ?? 100);
      if (Math.random() * 100 < counterChance && !killed) {
        const strike = resolveGuaranteedStrike({
          sourceStats: defStats,
          sourceActive: defActive,
          sourceName: defName,
          targetStats: atkStats,
          targetActive: atkActive,
          targetName: atkName,
          targetHpRef: atkHpRef,
          targetKey: atkTargetKey,
          round,
          log,
          roundDamageState,
          verbPool: COUNTER_PHRASES,
          damageLabel: "傷害",
        });
        if (strike.killed) killed = true;
      }
    }

    // 弓：閃躲後追擊
    if (atkStats.weaponType === "bow" && !killed) {
      const isBreak = Math.random() * 100 < atkStats.armorBreakChance;
      const finalDef = isBreak ? 0 : calcEffDef(0);
      let cdmg = rollDmg(Math.max(1, Math.round(atkStats.atk * atkMultiplier * finalDmgMult * (1 - finalDef / 100))));
      cdmg = Math.round(cdmg * (atkStats.archerBowDamageBoost || 1.2));
      const hasCrit = Math.random() * 100 < (atkStats.bowDodgeCounterCritRate || 5);
      if (hasCrit) cdmg = Math.round(cdmg * (atkStats.bowDodgeCounterCritMultiplier || 1.2));
      const capResult = applyRoundDamageCap({
        targetKey: defTargetKey,
        rawDamage: cdmg,
        roundDamageState,
      });
      cdmg = capResult.damage;
      defHpRef.value -= cdmg;
      const archerTag = atkStats.hasArcherBadge ? " **(弓箭手)**" : "";
      const critTag   = hasCrit ? "🎯命中要害！" : "";
      log.push(`🏹 **閃躲後追擊**${archerTag}！${rand(COUNTER_PHRASES)}，${critTag}對 **${defName}** 造成 **${cdmg}** 點傷害！（${defName} 剩 ${Math.max(0, defHpRef.value)} HP）`);
      pushCappedNotice(log, defName, capResult.capped);
      if (defHpRef.value <= 0) killed = true;
    }
  } else {
    // 命中
    const isBreak = Math.random() * 100 < atkStats.armorBreakChance;
    const effectiveDef = calcEffDef(0);
    const finalDef = isBreak ? 0 : effectiveDef;

    // 對有 debuff 的目標額外加成
    let condBonus = 1;
    if (hasAnyDebuff(defActive, round)) {
      // bonus_vs_debuffed 效果（若有的話，從 atkActive 找）
      const bvd = atkActive.filter(e => e.key === 'bonus_vs_debuffed' && effectIsActive(e, round));
      for (const b of bvd) condBonus *= (1 + Math.abs(Number(b.params?.value ?? 0)) / 100);
    }

    const attackBase = Math.max(1, Math.round(atkStats.atk * atkMultiplier * finalDmgMult * condBonus));
    let dmg = rollDmg(Math.max(1, Math.round(attackBase * (1 - finalDef / 100))));
    let wasBlocked = false;
    let blockNote = "";
    if (defStats.blockChance > 0 && Math.random() * 100 < defStats.blockChance) {
      wasBlocked = true;
      blockNote = `，但 **${defName}** ${rand(BLOCK_PHRASES)}`;
    }

    let isCrit = false;
    let isArcherCrit = false;

    // 職業傷害倍率
    if (atkStats.hasArcherBadge && atkStats.weaponType === "bow") {
      dmg = Math.round(dmg * (atkStats.archerBowDamageBoost || 1.2));
    }
    if (atkStats.hasMageBadge && atkStats.weaponType?.startsWith("staff")) {
      dmg = Math.round(dmg * (atkStats.mageDamageMultiplier || 1.15));
    }

    // 低血量爆發（戰士/卡片 on_low_hp）
    try {
      const eq = atkOpts.equipped;
      if (eq && atkHpRef.value <= Math.floor((atkStats.maxHp || 1) * 0.35)) {
        const lowFx = collectEquipmentEffects(eq, 'on_low_hp', { equipped: eq, inventory: atkOpts.inventory || [] });
        for (const eff of lowFx) {
          if (eff?.key === 'final_damage_up' && Number.isFinite(Number(eff.params?.value))) {
            dmg = Math.max(1, Math.round(dmg * Number(eff.params.value)));
          }
        }
      }
    } catch (_) {}

    const nonCritDamageBase = dmg;

    // 爆擊
    const effectiveCrit = Math.min(100, (atkStats.crit || 0) + critRateBonus);
    isCrit = Math.random() * 100 < effectiveCrit;
    // 弓箭手命中要害（獨立）
    if (atkStats.hasArcherBadge && atkStats.weaponType === "bow" && atkStats.archerCritRate > 0) {
      isArcherCrit = Math.random() * 100 < atkStats.archerCritRate;
    }

    let finalDamage = dmg;
    if (isCrit) {
      const critMult = (2.5 * critDmgMult) + (atkStats.warriorCritDamageBonus || 0);
      finalDamage = Math.round(rollDmg(Math.max(1, attackBase)) * critMult);
      if (atkStats.hasArcherBadge && atkStats.weaponType === "bow") {
        finalDamage = Math.round(finalDamage * (atkStats.archerBowDamageBoost || 1.2));
      }
    }
    if (isArcherCrit) finalDamage = Math.round(finalDamage * (atkStats.archerCritMultiplier || 1.5));

    if (wasBlocked) {
      if (isCrit || isArcherCrit) {
        finalDamage = Math.max(1, Math.round(nonCritDamageBase));
        blockNote += `，因對手爆擊擊破防禦，改以未爆擊傷害計算！`;
      } else {
        finalDamage = 1;
        blockNote += `，傷害降至 **1**！`;
      }
    }

    // 防守方傷害減免（damage_reduction debuff）
    if (damageRedPct > 0) finalDamage = Math.max(1, Math.round(finalDamage * (1 - Math.min(95, damageRedPct) / 100)));

    const capResult = applyRoundDamageCap({
      targetKey: defTargetKey,
      rawDamage: finalDamage,
      roundDamageState,
    });
    finalDamage = capResult.damage;
    defHpRef.value -= finalDamage;

    // 敘述
    const breakNote = isBreak ? "💥**破防**！" : "";
    let critNote = "";
    if (isCrit && isArcherCrit) critNote = `✨${rand(CRIT_PHRASES)}！🎯**命中要害**！`;
    else if (isArcherCrit)      critNote = `🎯**(弓箭手)** **${rand(['命中要害', '精準破綻', '弱點命中'])}**！`;
    else if (isCrit)            critNote = `✨**${rand(CRIT_PHRASES)}**！`;

    log.push(`⚔️ ${critNote}${breakNote}**${atkName}** ${rand(atkVerbs)}${blockNote}，對 **${defName}** 造成 **${finalDamage}** 點傷害！（${defName} 剩 ${Math.max(0, defHpRef.value)} HP）`);
    pushCappedNotice(log, defName, capResult.capped);

    // 吸血
    if (lifestealPct > 0) {
      const heal = Math.max(1, Math.round(finalDamage * lifestealPct / 100));
      atkHpRef.value = Math.min(atkStats.maxHp, atkHpRef.value + heal);
      log.push(`💚 **${atkName}** 吸取生命力！恢復 **${heal}** HP`);
    }

    if (defHpRef.value <= 0) { killed = true; }

    if (!killed && wasBlocked && defStats.blockCounter) {
      const strike = resolveGuaranteedStrike({
        sourceStats: defStats,
        sourceActive: defActive,
        sourceName: defName,
        targetStats: atkStats,
        targetActive: atkActive,
        targetName: atkName,
        targetHpRef: atkHpRef,
        targetKey: atkTargetKey,
        round,
        log,
        roundDamageState,
        verbPool: COUNTER_PHRASES,
        damageLabel: "傷害",
      });
      if (strike.killed) killed = true;
    }

    if (!killed) {
      const reactiveCounterEffects = getDefReactionEffects('counter_attack');
      for (const counterEff of reactiveCounterEffects) {
        const triggerChance = Number(counterEff.params?.value ?? 100);
        if (Math.random() * 100 >= triggerChance) continue;
        const pct = Number(counterEff.params?.counterDamagePct ?? 20);
        const reflected = Math.max(1, Math.round(finalDamage * (pct / 100)));
        const capResult = applyRoundDamageCap({
          targetKey: atkTargetKey,
          rawDamage: reflected,
          roundDamageState,
        });
        const finalCounter = capResult.damage;
        atkHpRef.value -= finalCounter;
        log.push(`🦀 **${defName}** 反擊！以受到傷害的 ${pct}% 回擊，對 **${atkName}** 造成 **${finalCounter}** 點傷害！（${atkName} 剩 ${Math.max(0, atkHpRef.value)} HP）`);
        pushCappedNotice(log, atkName, capResult.capped);
        if (atkHpRef.value <= 0) {
          killed = true;
          break;
        }
      }
    }

    if (!killed) {
      const reactiveReflectEffects = [
        ...getDefReactionEffects('reflect_damage'),
        ...getDefReactionEffects('thorns'),
      ];
      for (const reflectEff of reactiveReflectEffects) {
        const reflectPct = Number(reflectEff.params?.reflectPercent ?? reflectEff.params?.value ?? 50);
        const reflected = Math.max(1, Math.round(finalDamage * (reflectPct / 100)));
        const capResult = applyRoundDamageCap({
          targetKey: atkTargetKey,
          rawDamage: reflected,
          roundDamageState,
        });
        const finalReflect = capResult.damage;
        atkHpRef.value -= finalReflect;
        log.push(`🛡️ **${defName}** 反彈了 **${finalReflect}** 點傷害給 **${atkName}**！`);
        pushCappedNotice(log, atkName, capResult.capped);
        if (atkHpRef.value <= 0) {
          killed = true;
          break;
        }
      }
    }

    // ── 擊暈（槌類，非爆擊）───────────────────────────────
    if (!killed && !isCrit) {
      const effectiveStun = (atkStats.stunChance || 0);
      if (effectiveStun > 0 && Math.random() * 100 < effectiveStun) {
        // 對 defActive 加 stun 效果
        defActive = addOrStackEffect(defActive, {
          key: 'stun', params: { duration: { mode: 'turns', value: 3 } },
          appliedAt: round, sourceType: 'pvp_stun', sourceId: `${atkName}:stun`
        });
        log.push(`😵 **${defName}** ${rand(STUN_PHRASES)}！接下來 3 回合無法攻擊！`);
      }
    }

    // ── 職業徽章 on_hit proc（燒傷/麻痺/冰凍/中毒）──────
    if (!killed && atkSilenced) {
      log.push(`🔇 **${atkName}** 陷入沉默，此回合無法發動技能！`);
    }
    if (!killed && !atkSilenced) {
      const jobEq = atkOpts.equipped?.job_eq;
      const allProcs = [
        ...(Array.isArray(jobEq?.procEffects)   ? jobEq.procEffects   : []),
        ...(Array.isArray(jobEq?.combatEffects) ? jobEq.combatEffects : [])
      ];
      for (const pe of allProcs) {
        if (!pe || pe.trigger !== 'on_hit' || pe.target !== 'enemy') continue;
        if (pe.condition?.weaponType && pe.condition.weaponType !== wt) continue;
        if (Math.random() * 100 >= (pe.chance || 0)) continue;
        const pp = pe.params || {};
        const dur = { ...(pp.duration || { mode: 'turns', value: 3 }) };
        switch (pe.key) {
          case 'burn':
            defActive = addOrStackEffect(defActive, {
              key: 'burn', params: { value: pp.value ?? 0.5, mode: pp.mode ?? 'pct', duration: dur, sourceName: atkName },
              appliedAt: round, sourceType: 'pvp_job_proc', sourceId: `${atkName}:burn`
            });
            log.push(`🔥 **(法師)** **燒傷**！**${defName}** 陷入燃燒狀態，持續 ${dur.value ?? 3} 回合！`);
            break;
          case 'hit_down':
            defActive = addOrStackEffect(defActive, {
              key: 'hit_rate_down', params: { value: pp.value ?? 15, duration: dur, sourceName: atkName },
              appliedAt: round, sourceType: 'pvp_job_proc', sourceId: `${atkName}:hit_down`
            });
            log.push(`⚡ **(法師)** **麻痺**！**${defName}** 命中率下降，持續 ${dur.value ?? 3} 回合！`);
            break;
          case 'freeze':
            defActive = addOrStackEffect(defActive, {
              key: 'freeze', params: { duration: dur, sourceName: atkName },
              appliedAt: round + 1, sourceType: 'pvp_job_proc', sourceId: `${atkName}:freeze`
            });
            log.push(`🧊 **(法師)** **冰凍**！**${defName}** 下回合無法攻擊！`);
            break;
          case 'proc_poison': {
            const existing = defActive.find(e => e.key === 'poison' && e.sourceId === `${atkName}:poison`);
            const prevPct = existing ? Number(existing.params?.value ?? 0) : 0;
            let dexB = !existing && pp.dexMultiplier ? Number(atkStats.dex ?? 0) * Number(pp.dexMultiplier) : 0;
            const nextPct = Math.ceil(Math.min(pp.maxPct ?? 3.5, prevPct + (existing ? (pp.stackAdd ?? 1) : (pp.value ?? 0.5)) + dexB) * 10) / 10;
            defActive = addOrStackEffect(defActive, {
              key: 'poison', params: { value: nextPct, mode: 'pct', duration: dur, sourceName: atkName },
              appliedAt: round, sourceType: 'pvp_job_proc', sourceId: `${atkName}:poison`
            });
            log.push(existing
              ? `☠️ **(盜賊)** **中毒加深**！**${defName}** 毒性增強至每回合 ${nextPct}% HP！`
              : `☠️ **(盜賊)** **中毒**！**${defName}** 陷入中毒，每回合損失 ${nextPct}% HP！`
            );
            break;
          }
        }
      }
    }

    // ── 卡片技能（所有裝備欄位）────────────────────────────
    if (!killed && !atkSilenced) {
      const OFFENSIVE_KEYS = new Set([
        'atk_down', 'def_down', 'poison', 'bleed', 'burn', 'freeze', 'stun',
        'silence', 'charm', 'lightning', 'freeze_slow', 'hit_down', 'hit_rate_down',
        'agi_down', 'dark_curse'
      ]);
      const cardEntries = Object.entries(atkOpts.equipped || {})
        .filter(([, slotItem]) => slotItem?.monsterCardSkill?.key);
      for (const [slot, slotItem] of cardEntries) {
        const skill     = slotItem.monsterCardSkill;
        const cardName  = slotItem.itemName || slotItem.name || '卡片';
        const cooldownKey = slotItem.itemId || slotItem.id || `${slot}:${cardName}`;
        const triggerChance = Math.min(100, Math.max(0, Number(skill.chance ?? slotItem.cardProcChance ?? 5)));
        const atkHpPct = atkStats.maxHp > 0 ? (atkHpRef.value / atkStats.maxHp) * 100 : 100;
        const defHpPct = defStats.maxHp  > 0 ? (defHpRef.value / defStats.maxHp)  * 100 : 100;

        if ((atkOpts._cardCooldowns?.[cooldownKey] || 0) > 0) continue;
        if (Math.random() * 100 >= triggerChance) continue;

        const procEffects = Array.isArray(skill.procEffects) ? skill.procEffects : [];
        if (procEffects.length === 0) continue;

        if (Number(skill.cooldownTurns) > 0) {
          if (!atkOpts._cardCooldowns) atkOpts._cardCooldowns = {};
          atkOpts._cardCooldowns[cooldownKey] = Number(skill.cooldownTurns);
        }

        const shouldShowGenericSkillLine = !procEffects.some((effect) => IMMEDIATE_LOG_SUPPRESS_KEYS.has(effect?.key));
        let appliedAnyProc = false;

        for (const pe of procEffects) {
          if (!pe || !pe.key) continue;
          const pp = pe.params || {};
          const chance = Number.isFinite(Number(pe.chance)) ? Number(pe.chance) : 100;
        if (Math.random() * 100 >= chance) continue;
        // HP 門檻
        if (Number.isFinite(Number(pp.ownerHpAbovePct)) && atkHpPct <= Number(pp.ownerHpAbovePct)) continue;
        if (Number.isFinite(Number(pp.ownerHpBelowPct)) && atkHpPct >= Number(pp.ownerHpBelowPct)) continue;
        if (Number.isFinite(Number(pp.targetHpBelowPct)) && defHpPct >= Number(pp.targetHpBelowPct)) continue;

        const skillName = skill.name || cardName;
        const isImmediateDamage = IMMEDIATE_DAMAGE_KEYS.has(pe.key);
        const entry = {
          key: pe.key,
          params: { ...pp },
          stackMode: pe.stackMode,
          appliedAt: round,
          sourceType: 'pvp_card',
          sourceId: `${slot}:${slotItem.uuid || slotItem.itemId || cardName}`
        };
        entry.params.sourceName = atkName;
        if (IMMEDIATE_HEAL_KEYS.has(pe.key)) {
          const healBase = pp.mode === 'flat'
            ? Math.max(1, Number(pp.value ?? 0))
            : Math.max(1, Number(pp.value ?? 5));
          const healPct = Number.isFinite(Number(pp.value)) ? Math.abs(Number(pp.value)) : 5;
          const healAmount = pp.mode === 'flat'
            ? healBase
            : Math.max(1, Math.round((atkStats.maxHp || 1) * (healPct / 100)));
          dealImmediateSkillHeal({
            log,
            sourceName: atkName,
            skillName: skill.name || cardName,
            targetName: atkName,
            targetHpRef: atkHpRef,
            targetMaxHp: atkStats.maxHp || atkHpRef.value || 1,
            rawHeal: healAmount,
            healLabel: "回復",
          });
          appliedAnyProc = true;
          if (skill.cooldownTurns > 0) {
            if (!atkOpts._cardCooldowns) atkOpts._cardCooldowns = {};
            atkOpts._cardCooldowns[cooldownKey] = Number(skill.cooldownTurns);
          }
          continue;
        }
        if (isImmediateDamage && (pe.target === 'enemy' || OFFENSIVE_KEYS.has(pe.key))) {
          const immediateBase = pp.mode === 'caster_atk_pct'
            ? Math.max(1, Number(pp.casterAtk || 1))
            : defStats.maxHp;
          const pct = Number(pp.value ?? (
            pe.key === 'lightning' ? 0.2 :
            pe.key === 'bleed' ? 0.1 :
            0.5
          ));
          const immediateDamage = Math.max(1, Math.round(immediateBase * (pct / 100)));
          const label = pe.key === 'burn' ? '灼燒'
            : pe.key === 'poison' ? '毒素'
            : pe.key === 'bleed' ? '流血'
            : '雷電';
          dealImmediateSkillDamage({
            log,
            sourceName: atkName,
            skillName,
            targetName: defName,
            targetHpRef: defHpRef,
            targetKey: defTargetKey,
            roundDamageState,
            rawDamage: immediateDamage,
            damageLabel: label,
          });
          appliedAnyProc = true;
          if (defHpRef.value <= 0) {
            killed = true;
            break;
          }
          continue;
        }
        if (pe.target === 'enemy' || OFFENSIVE_KEYS.has(pe.key)) {
          defActive = addOrStackEffect(defActive, entry);
          appliedAnyProc = true;
        } else {
          atkActive = addOrStackEffect(atkActive, entry);
          appliedAnyProc = true;
        }
      }
        if (shouldShowGenericSkillLine && appliedAnyProc) {
          log.push(`🎴 **${atkName}** 發動【${skill.name || cardName}】！${skill.description || ""}`);
        }
    }
    }

    // ── 斬殺（被動，雙手劍職業）──────────────────────────
    if (!killed && atkStats.executeChance > 0 && atkStats.executeThresholdPct > 0) {
      const thr = Math.max(1, Math.floor(defStats.maxHp * (atkStats.executeThresholdPct / 100)));
      if (defHpRef.value > 0 && defHpRef.value <= thr && Math.random() * 100 < atkStats.executeChance) {
        defHpRef.value = 0;
        killed = true;
        log.push(`🗡️ **斬殺觸發**！**${defName}** 生命過低，直接被終結！`);
      }
    }

    // ── 連擊 ───────────────────────────────────────────
    if (!killed) {
      let comboChance = atkStats.combo;
      if (atkStats.hasRogueBadge && atkStats.weaponType === "dagger") comboChance = Math.min(80, comboChance + 10);
      if (Math.random() * 100 < comboChance) {
      const comboBase = Math.max(1, Math.round(atkStats.atk * atkMultiplier * finalDmgMult * condBonus * (1 - calcEffDef() / 100)));
      let cdmg = Math.max(1, Math.round(rollDmg(comboBase) * (atkStats.comboDamageMultiplier || 1)));
      if (atkStats.hasRogueBadge && atkStats.weaponType === "dagger") cdmg = Math.round(cdmg * 1.1);
      const capResult = applyRoundDamageCap({
        targetKey: defTargetKey,
        rawDamage: cdmg,
        roundDamageState,
      });
      cdmg = capResult.damage;
      defHpRef.value -= cdmg;
      log.push(`⚡ **${rand(COMBO_PHRASES)}** **${atkName}** 追加攻擊造成 **${cdmg}** 點傷害！（${defName} 剩 ${Math.max(0, defHpRef.value)} HP）`);
      pushCappedNotice(log, defName, capResult.capped);
      if (defHpRef.value <= 0) killed = true;
    }
  }
  }

  return { killed, atkActive, defActive };
}

// ── 目標受到 DOT 傷害 ────────────────────────────────────────
// 在每個玩家「出招前」先處理自身身上的 DOT
function applyDotEffects({ name, hpRef, maxHp, activeEffects, round, log, targetKey, roundDamageState }) {
  let dead = false;
  let frozen = false;
  let silenced = false;
  let stunRoundsLeft = 0;

  for (const eff of activeEffects) {
    if (!eff || !effectIsActive(eff, round)) continue;
    const p = eff.params || {};

    if (eff.key === 'freeze' && eff.appliedAt === round) {
      frozen = true;
      log.push(`🧊 **${name}** 被冰凍，此回合無法攻擊！`);
    }
    if (eff.key === 'stun') {
      const stunEnd = (eff.appliedAt || 1) + (p.duration?.value || 1);
      if (round <= stunEnd) {
        stunRoundsLeft = Math.max(stunRoundsLeft, stunEnd - round + 1);
        if (round > (eff.appliedAt || 1)) {
          log.push(`😵 **${name}** 仍處於眩暈中，無法攻擊！`);
          frozen = true; // 借用 frozen 讓攻擊跳過
        }
      }
    }
    if (eff.key === 'silence') silenced = true;

    const base = p.mode === 'caster_atk_pct' ? Math.max(1, Number(p.casterAtk || 1)) : maxHp;
    const sourceSkillName = p.sourceSkillName || null;
    const sourceName = p.sourceName || sourceSkillName || null;
    if (eff.key === 'burn') {
      const dmg = Math.max(1, Math.round(base * (Number(p.value ?? 0.5) / 100)));
      const capResult = applyRoundDamageCap({
        targetKey,
        rawDamage: dmg,
        roundDamageState,
      });
      const finalDmg = capResult.damage;
      hpRef.value -= finalDmg;
      log.push(sourceName
        ? `🎴 **${sourceName}** 發動【持續燃燒】！**${name}** 受到 **${finalDmg}** 點灼燒傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
        : `🔥 燒傷持續！**${name}** 受到 **${finalDmg}** 點灼燒傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
      );
      pushCappedNotice(log, name, capResult.capped);
      if (hpRef.value <= 0) dead = true;
    }
    if (eff.key === 'poison') {
      const dmg = Math.max(1, Math.round(base * (Number(p.value ?? 0.5) / 100)));
      const capResult = applyRoundDamageCap({
        targetKey,
        rawDamage: dmg,
        roundDamageState,
      });
      const finalDmg = capResult.damage;
      hpRef.value -= finalDmg;
      log.push(sourceName
        ? `🎴 **${sourceName}** 發動【持續中毒】！**${name}** 受到 **${finalDmg}** 點毒素傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
        : `☠️ 中毒持續！**${name}** 受到 **${finalDmg}** 點毒素傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
      );
      pushCappedNotice(log, name, capResult.capped);
      if (hpRef.value <= 0) dead = true;
    }
    if (eff.key === 'bleed') {
      const dmg = Math.max(1, Math.round(base * (Number(p.value ?? 0.1) / 100)));
      const capResult = applyRoundDamageCap({
        targetKey,
        rawDamage: dmg,
        roundDamageState,
      });
      const finalDmg = capResult.damage;
      hpRef.value -= finalDmg;
      log.push(sourceName
        ? `🎴 **${sourceName}** 發動【持續流血】！**${name}** 受到 **${finalDmg}** 點流血傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
        : `🩸 流血持續！**${name}** 受到 **${finalDmg}** 點流血傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
      );
      pushCappedNotice(log, name, capResult.capped);
      if (hpRef.value <= 0) dead = true;
    }
    if (eff.key === 'lightning') {
      const dmg = Math.max(1, Math.round(base * (Number(p.value ?? 0.2) / 100)));
      const capResult = applyRoundDamageCap({
        targetKey,
        rawDamage: dmg,
        roundDamageState,
      });
      const finalDmg = capResult.damage;
      hpRef.value -= finalDmg;
      log.push(sourceName
        ? `🎴 **${sourceName}** 發動【雷擊】！**${name}** 受到 **${finalDmg}** 點雷電傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
        : `⚡ 閃電持續！**${name}** 受到 **${finalDmg}** 點雷電傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
      );
      pushCappedNotice(log, name, capResult.capped);
      if (hpRef.value <= 0) dead = true;
    }
    if (eff.key === 'shock_dot') {
      const dmg = Math.max(1, Math.round(base * (Number(p.value ?? 20) / 100)));
      const capResult = applyRoundDamageCap({
        targetKey,
        rawDamage: dmg,
        roundDamageState,
      });
      const finalDmg = capResult.damage;
      hpRef.value -= finalDmg;
      log.push(sourceName
        ? `🎴 **${sourceName}** 發動【持續震盪】！**${name}** 受到 **${finalDmg}** 點震盪傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
        : `⚡ 震盪持續！**${name}** 受到 **${finalDmg}** 點震盪傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
      );
      pushCappedNotice(log, name, capResult.capped);
      if (hpRef.value <= 0) dead = true;
    }
    if (eff.key === 'curse_dot') {
      const dmg = Math.max(1, Math.round(base * (Number(p.value ?? 20) / 100)));
      const capResult = applyRoundDamageCap({
        targetKey,
        rawDamage: dmg,
        roundDamageState,
      });
      const finalDmg = capResult.damage;
      hpRef.value -= finalDmg;
      log.push(sourceName
        ? `🎴 **${sourceName}** 發動【持續詛咒】！**${name}** 受到 **${finalDmg}** 點詛咒傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
        : `🌑 詛咒持續！**${name}** 受到 **${finalDmg}** 點詛咒傷害！（${name} 剩 ${Math.max(0, hpRef.value)} HP）`
      );
      pushCappedNotice(log, name, capResult.capped);
      if (hpRef.value <= 0) dead = true;
    }
    if (eff.key === 'heal_over_time') {
      const heal = p.mode === 'flat'
        ? Math.max(0, Math.round(Number(p.value ?? 0)))
        : Math.max(0, Math.round(maxHp * (Number(p.value ?? 0) / 100)));
      if (heal > 0) {
        hpRef.value = Math.min(maxHp, hpRef.value + heal);
        log.push(`💚 **${name}** 回復效果發動，恢復 **${heal}** HP（${name} 剩 ${hpRef.value}）`);
      }
    }

    if (dead) break;
  }

  return { dead, frozen, silenced, stunRoundsLeft };
}

// ── 主要 PvP 迴圈 ────────────────────────────────────────────
/**
 * @param {object} aStats  calcPlayerStats（先攻方）
 * @param {object} aOpts   { equipped, inventory, activeEffects }
 * @param {string} aName
 * @param {object} bStats  calcPlayerStats（後攻方）
 * @param {object} bOpts   { equipped, inventory, activeEffects }
 * @param {string} bName
 * @param {number} MAX_ROUNDS
 * @returns {{ winner, roundLogs, finalHpA, finalHpB, hpPctA, hpPctB }}
 */
function runPkCombat(aStats, aOpts, aName, bStats, bOpts, bName, MAX_ROUNDS = 15) {
  const aHpRef = { value: aStats.maxHp };
  const bHpRef = { value: bStats.maxHp };
  let aActive  = Array.isArray(aOpts.activeEffects) ? [...aOpts.activeEffects] : [];
  let bActive  = Array.isArray(bOpts.activeEffects) ? [...bOpts.activeEffects] : [];
  const roundDamageState = createRoundDamageState(aStats, bStats);

  // 冷卻注入到 opts（card cooldowns）
  aOpts._cardCooldowns = {};
  bOpts._cardCooldowns = {};

  const roundLogs = [];
  let winner = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const log = [`**【第 ${round} 回合】**`];
    roundDamageState.A.taken = 0;
    roundDamageState.B.taken = 0;
    roundDamageState.A.noticeShown = false;
    roundDamageState.B.noticeShown = false;

    // 冷卻倒數
    for (const k of Object.keys(aOpts._cardCooldowns)) aOpts._cardCooldowns[k] = Math.max(0, aOpts._cardCooldowns[k] - 1);
    for (const k of Object.keys(bOpts._cardCooldowns)) bOpts._cardCooldowns[k] = Math.max(0, bOpts._cardCooldowns[k] - 1);

    // ── A 的 DOT / Buff / 眩暈 ─────────────────────────────
    const aDot = applyDotEffects({ name: aName, hpRef: aHpRef, maxHp: aStats.maxHp, activeEffects: aActive, round, log, targetKey: "A", roundDamageState });
    if (aDot.dead) { winner = "B"; roundLogs.push(log.join("\n")); break; }

    // ── B 的 DOT / Buff / 眩暈 ─────────────────────────────
    const bDot = applyDotEffects({ name: bName, hpRef: bHpRef, maxHp: bStats.maxHp, activeEffects: bActive, round, log, targetKey: "B", roundDamageState });
    if (bDot.dead) { winner = "A"; roundLogs.push(log.join("\n")); break; }

    // ── A 出招 ─────────────────────────────────────────────
    if (!aDot.frozen) {
      const r = attackerTurn({
        atkStats: aStats, atkOpts: aOpts, atkName: aName,
        atkHp: aHpRef.value, atkHpRef: aHpRef, atkActive: aActive,
        atkTargetKey: "A",
        defStats: bStats, defOpts: bOpts, defName: bName, defHpRef: bHpRef, defActive: bActive,
        defTargetKey: "B",
        round, log, stunRoundsLeft: bDot.stunRoundsLeft, defFrozen: bDot.frozen,
        roundDamageState,
      });
      aActive = r.atkActive;
      bActive = r.defActive;
      if (r.killed) { winner = "A"; roundLogs.push(log.join("\n")); break; }
    } else {
      log.push(`⏸️ **${aName}** 無法行動！`);
    }

    // ── B 出招 ─────────────────────────────────────────────
    if (!bDot.frozen) {
      const r = attackerTurn({
        atkStats: bStats, atkOpts: bOpts, atkName: bName,
        atkHp: bHpRef.value, atkHpRef: bHpRef, atkActive: bActive,
        atkTargetKey: "B",
        defStats: aStats, defOpts: aOpts, defName: aName, defHpRef: aHpRef, defActive: aActive,
        defTargetKey: "A",
        round, log, stunRoundsLeft: aDot.stunRoundsLeft, defFrozen: aDot.frozen,
        roundDamageState,
      });
      bActive = r.atkActive;
      aActive = r.defActive;
      if (r.killed) { winner = "B"; roundLogs.push(log.join("\n")); break; }
    } else {
      log.push(`⏸️ **${bName}** 無法行動！`);
    }

    // 清理過期效果
    aActive = cleanExpiredEffects(aActive, round);
    bActive = cleanExpiredEffects(bActive, round);

    roundLogs.push(log.join("\n"));
  }

  const finalHpA = Math.max(0, aHpRef.value);
  const finalHpB = Math.max(0, bHpRef.value);
  const hpPctA   = Math.round((finalHpA / aStats.maxHp) * 100);
  const hpPctB   = Math.round((finalHpB / bStats.maxHp) * 100);

  // 以最終剩餘 HP 再校正一次勝負，避免中途反擊 / 反彈造成的判定與最終結果不一致
  if (finalHpA <= 0 && finalHpB > 0) {
    winner = "B";
  } else if (finalHpB <= 0 && finalHpA > 0) {
    winner = "A";
  } else if (winner === null) {
    if (hpPctA > hpPctB)      winner = "A";
    else if (hpPctB > hpPctA) winner = "B";
    // else null = 平局
  }

  return { winner, roundLogs, finalHpA, finalHpB, hpPctA, hpPctB };
}

module.exports = { runPkCombat };
