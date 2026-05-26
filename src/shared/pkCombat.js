"use strict";

/**
 * PK 玩家 vs 玩家戰鬥引擎
 *
 * 雙方都走完整的攻擊邏輯（職業技能、卡片技能、DOT、Buff/Debuff、
 * 連擊、雙持副手第二主攻、副手反擊（被攻後觸發）、盾反、格擋、斬殺全部生效）。
 * 每回合：先攻方出招 → 後攻方出招（若先攻方打死則提前結束）。
 */

const {
  collectEquipmentEffects,
} = require("./effectEngine");
const { calcHitChance } = require("./hitChance");
const {
  calcAttackTierProbs,
  calcDefenseTierProbs,
  rollAttackTier,
  rollDefenseTier,
  ATTACK_TIER_MULT,
  DEFENSE_TIER_MULT,
} = require("./combatStats");

// ── 從 combatLoop 借用純工具函式 ─────────────────────────────
// 直接 inline 以避免循環依賴（combatLoop 沒有 export 這些）
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── 等級壓制（非對稱）/ 新 DEF 公式 (與 PvE combatLoop 對齊) ──
// 高打低：+0~+20% ；低打高：-0~-50% ；每差 1 級 ±2%
const PK_LEVEL_DIFF_PCT = 2;
const PK_LEVEL_DIFF_CAP_UP = 20;
const PK_LEVEL_DIFF_CAP_DOWN = 50;
function pkLevelMult(srcLv, dstLv) {
  const diff = Math.max(1, srcLv || 1) - Math.max(1, dstLv || 1);
  if (diff >= 0) return 1 + Math.min(PK_LEVEL_DIFF_CAP_UP, diff * PK_LEVEL_DIFF_PCT) / 100;
  return 1 - Math.min(PK_LEVEL_DIFF_CAP_DOWN, -diff * PK_LEVEL_DIFF_PCT) / 100;
}
function pkApplyDefense(rawDmg, flatDef, pctDef, rawAtk = null) {
  // 新公式 B：flatDef 壓制原始 ATK，等同於 flatDef 被攻擊乘數放大
  // (atk × M − flatDef × M) × (1 − DEF%) = ((atk − flatDef) × M) × (1 − DEF%)
  let effectiveFlatDef = Math.max(0, flatDef || 0);
  if (rawAtk && rawAtk > 0 && rawDmg > rawAtk) {
    effectiveFlatDef *= (rawDmg / rawAtk);
  }
  const afterFlat = Math.max(0, rawDmg - effectiveFlatDef);
  const finalPct = Math.max(0, Math.min(95, pctDef || 0));
  return Math.max(1, Math.round(afterFlat * (1 - finalPct / 100)));
}

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
  const idx = next.findIndex((e) => {
    if (e?.key !== entry.key) return false;
    if (e.sourceId && entry.sourceId) return e.sourceId === entry.sourceId;
    return e.sourceType === entry.sourceType;
  });
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

// 預設 25% per-round HP cap；benchmark 可設 PK_ROUND_DAMAGE_CAP_PCT=999 等大值繞過
const ROUND_DAMAGE_CAP_PCT = Math.max(1, Number(process.env.PK_ROUND_DAMAGE_CAP_PCT) || 25);
const IMMEDIATE_HEAL_KEYS = new Set(["heal_over_time", "life_regen", "mana_regen", "on_hit_heal", "on_crit_heal"]);
const IMMEDIATE_DAMAGE_KEYS = new Set(["burn", "poison", "bleed", "lightning", "shock_dot", "curse_dot"]);
const IMMEDIATE_LOG_SUPPRESS_KEYS = new Set([...IMMEDIATE_DAMAGE_KEYS, ...IMMEDIATE_HEAL_KEYS]);
const PK_CARD_OFFENSIVE_KEYS = new Set([
  'atk_down', 'def_down', 'poison', 'bleed', 'burn', 'freeze', 'stun',
  'silence', 'charm', 'lightning', 'freeze_slow', 'hit_down', 'hit_rate_down',
  'agi_down', 'dodge_down', 'dark_curse'
]);

function hasMultiTurnDuration(effect) {
  const duration = effect?.duration || effect?.params?.duration || null;
  return duration?.mode === "turns" && Number(duration.value || 0) > 1;
}

function shouldApplyAsImmediateDamage(effect) {
  return IMMEDIATE_DAMAGE_KEYS.has(effect?.key) && !hasMultiTurnDuration(effect);
}

function shouldApplyAsImmediateHeal(effect) {
  return IMMEDIATE_HEAL_KEYS.has(effect?.key) && !hasMultiTurnDuration(effect);
}

function shouldSuppressImmediateLog(effect) {
  return shouldApplyAsImmediateDamage(effect) || shouldApplyAsImmediateHeal(effect);
}

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

function hasActiveInvincible(activeEffects = [], round = 1) {
  return (activeEffects || []).some((eff) => eff?.key === "invincible_short" && effectIsActive(eff, round));
}

function applyInvincibleDamage(rawDamage, activeEffects = [], round = 1) {
  return hasActiveInvincible(activeEffects, round) ? 0 : rawDamage;
}

function effectHasHpThreshold(effect = {}) {
  const p = effect.params || {};
  return Number.isFinite(Number(p.ownerHpBelowPct))
    || Number.isFinite(Number(p.ownerHpAbovePct))
    || Number.isFinite(Number(p.targetHpBelowPct));
}

function hpThresholdApplies(effect = {}, ownerHpPct = 100, targetHpPct = 100) {
  const p = effect.params || {};
  if (Number.isFinite(Number(p.ownerHpAbovePct)) && ownerHpPct <= Number(p.ownerHpAbovePct)) return false;
  if (Number.isFinite(Number(p.ownerHpBelowPct)) && ownerHpPct >= Number(p.ownerHpBelowPct)) return false;
  if (Number.isFinite(Number(p.targetHpBelowPct)) && targetHpPct >= Number(p.targetHpBelowPct)) return false;
  return true;
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
  allowBlock = false,
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

  // 等級壓制
  const levelMult = pkLevelMult(sourceStats.level, targetStats.level);
  const attackBase = Math.max(1, Math.round(sourceStats.atk * atkMultiplier * finalDmgMult * levelMult));
  const finalDef = calcEffDef();
  // 新公式：(ATK − targetFlatDef) × (1 − finalDef/100)
  let dmg = Math.max(1, Math.round(rollDmg(pkApplyDefense(attackBase, targetStats.flatDef || 0, finalDef, sourceStats.atk), sourceStats)));
  const nonCritDamageBase = dmg;

  const effectiveCrit = Math.min(100, (sourceStats.crit || 0) + critRateBonus);
  const isCrit = Math.random() * 100 < effectiveCrit;
  if (isCrit) {
    // 爆擊：與普攻一樣過 DEF，倍率 ×2
    const critPostDef = pkApplyDefense(attackBase, targetStats.flatDef || 0, finalDef, sourceStats.atk);
    dmg = Math.round(rollDmg(critPostDef, sourceStats) * (2 * critDmgMult));
  }

  let blockNote = "";
  if (allowBlock && targetStats.blockChance > 0 && Math.random() * 100 < targetStats.blockChance) {
    blockNote = `，但 **${targetName}** ${rand(BLOCK_PHRASES)}`;
    if (isCrit) {
      dmg = Math.max(1, Math.round(nonCritDamageBase));
      blockNote += `，因對手爆擊擊破防禦，改以未爆擊傷害計算！`;
    } else {
      dmg = 1;
      blockNote += `，傷害降至 **1**！`;
    }
  }
  if (damageRedPct > 0) dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, damageRedPct) / 100)));
  dmg = applyInvincibleDamage(dmg, targetActive, round);

  const capResult = applyRoundDamageCap({
    targetKey,
    rawDamage: dmg,
    roundDamageState,
  });
  const finalDamage = capResult.damage;
  targetHpRef.value -= finalDamage;
  log.push(`⚔️ **${sourceName}** ${rand(verbPool)}${blockNote}，對 **${targetName}** 造成 **${finalDamage}** 點${damageLabel}！（${targetName} 剩 ${Math.max(0, targetHpRef.value)} HP）`);
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

function applyPkHpGatedSelfCards({
  actorStats,
  actorOpts,
  actorName,
  actorHpRef,
  actorActive,
  targetStats,
  targetHpRef,
  round,
  log,
}) {
  let nextActive = Array.isArray(actorActive) ? actorActive : [];
  if (!actorOpts?._cardCooldowns) actorOpts._cardCooldowns = {};

  for (const [slot, slotItem] of Object.entries(actorOpts?.equipped || {})) {
    const skill = slotItem?.monsterCardSkill;
    if (!skill?.key) continue;
    const skillName = skill.name || slotItem.itemName || slotItem.name || "卡片";
    const cooldownKey = slotItem.itemId || slotItem.id || `${slot}:${skillName}`;
    if (Number(actorOpts._cardCooldowns[cooldownKey] || 0) > 0) continue;

    const procEffects = (Array.isArray(skill.procEffects) ? skill.procEffects : [])
      .filter((effect) => effectHasHpThreshold(effect)
        && effect.target !== "enemy"
        && !PK_CARD_OFFENSIVE_KEYS.has(effect.key));
    if (procEffects.length === 0) continue;

    const ownerHpPct = actorStats.maxHp > 0 ? (actorHpRef.value / actorStats.maxHp) * 100 : 100;
    const targetHpPct = targetStats.maxHp > 0 ? (targetHpRef.value / targetStats.maxHp) * 100 : 100;
    const matched = procEffects.filter((effect) => hpThresholdApplies(effect, ownerHpPct, targetHpPct));
    if (matched.length === 0) continue;

    if (Number(skill.cooldownTurns) > 0) {
      actorOpts._cardCooldowns[cooldownKey] = Number(skill.cooldownTurns);
    }

    let appliedAny = false;
    for (const effect of matched) {
      const pp = effect.params || {};
      const chance = Number.isFinite(Number(effect.chance)) ? Number(effect.chance) : 100;
      if (Math.random() * 100 >= chance) continue;
      if (shouldApplyAsImmediateHeal(effect)) {
        const healPct = Number.isFinite(Number(pp.value)) ? Math.abs(Number(pp.value)) : 5;
        const healAmount = pp.mode === "flat"
          ? Math.max(1, Number(pp.value ?? 0))
          : Math.max(1, Math.round((actorStats.maxHp || 1) * (healPct / 100)));
        dealImmediateSkillHeal({
          log,
          sourceName: actorName,
          skillName,
          targetName: actorName,
          targetHpRef: actorHpRef,
          targetMaxHp: actorStats.maxHp || actorHpRef.value || 1,
          rawHeal: healAmount,
          healLabel: "回復",
        });
        appliedAny = true;
        continue;
      }
      const duration = effect.duration || pp.duration;
      const entry = {
        key: effect.key,
        params: duration && !pp.duration ? { ...pp, duration } : { ...pp },
        stackMode: effect.stackMode,
        appliedAt: round,
        sourceType: "pvp_card",
        sourceId: `${slot}:${slotItem.uuid || slotItem.itemId || slotItem.id || skillName}`,
      };
      entry.params.sourceName = actorName;
      nextActive = addOrStackEffect(nextActive, entry);
      appliedAny = true;
    }
    if (appliedAny && !matched.some((effect) => shouldSuppressImmediateLog(effect))) {
      log.push(`🎴 **${actorName}** 發動【${skillName}】！${skill.description || ""}`);
    }
  }

  return nextActive;
}

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

  if (!atkSilenced) {
    atkActive = applyPkHpGatedSelfCards({
      actorStats: atkStats,
      actorOpts: atkOpts,
      actorName: atkName,
      actorHpRef: atkHpRef,
      actorActive: atkActive,
      targetStats: defStats,
      targetHpRef: defHpRef,
      round,
      log,
    });
  }

  // ── 職業技能觸發（35% 機率，每回合限一次，回合開頭讀取 HP 條件後發動）──
  if (!atkSilenced && !atkOpts._jobSkillUsed) {
    const jobSkills = Array.isArray(atkOpts.equipped?.job_eq?.jobSkills) ? atkOpts.equipped.job_eq.jobSkills : [];
    const jobName = atkOpts.equipped?.job_eq?.itemName || atkOpts.equipped?.job_eq?.name || '職業技能';
    if (jobSkills.length > 0 && Math.random() < 0.35) {
      const atkHpPct = atkStats.maxHp > 0 ? (atkHpRef.value / atkStats.maxHp) * 100 : 100;
      if (!atkOpts._jobSkillCooldowns) atkOpts._jobSkillCooldowns = {};
      const available = jobSkills.filter(sk => {
        if (!sk?.key) return false;
        if ((atkOpts._jobSkillCooldowns[sk.key] || 0) > 0) return false;
        const c = sk.condition || {};
        if (Number.isFinite(Number(c.ownerHpAbovePct)) && atkHpPct <= Number(c.ownerHpAbovePct)) return false;
        if (Number.isFinite(Number(c.ownerHpBelowPct)) && atkHpPct >= Number(c.ownerHpBelowPct)) return false;
        return true;
      });
      if (available.length > 0) {
        const chosen = available[Math.floor(Math.random() * available.length)];
        atkOpts._jobSkillUsed = true;
        if (Number(chosen.cooldownTurns) > 0) atkOpts._jobSkillCooldowns[chosen.key] = Number(chosen.cooldownTurns);
        const JOB_SKILL_SELF_KEYS = new Set([
          'atk_up', 'crit_rate_up', 'crit_damage_up', 'def_up', 'dodge_up', 'hit_up',
          'block_chance_up', 'damage_reduction', 'invincible_short', 'combo_damage_up',
          'final_damage_up', 'def_ignore', 'heal_over_time'
        ]);
        const JOB_SKILL_ENEMY_KEYS = new Set([
          'atk_down', 'def_down', 'hit_down', 'agi_down', 'dodge_down', 'stun',
          'silence', 'poison', 'bleed', 'burn', 'freeze', 'damage_taken_up',
          'final_damage_down'
        ]);
        let skillApplied = false;
        for (const pe of (Array.isArray(chosen.procEffects) ? chosen.procEffects : [])) {
          if (!pe?.key) continue;
          const pp = pe.params || {};
          if (pe.key === 'heal_over_time' && pe.target === 'self') {
            const heal = Math.max(1, Math.round(atkStats.maxHp * Number(pp.value || 5) / 100));
            atkHpRef.value = Math.min(atkStats.maxHp, atkHpRef.value + heal);
            log.push(`✨ **(${jobName})** 發動【${chosen.name}】！回復 **${heal}** HP（${atkName} 剩 ${atkHpRef.value} / ${atkStats.maxHp}）`);
            skillApplied = true;
            continue;
          }
          const entry = {
            key: pe.key, params: { ...pp },
            stackMode: pe.stackMode || 'replace',
            appliedAt: round,
            sourceType: 'pvp_job_skill',
            sourceId: `${atkName}:${chosen.key}:${pe.key}`
          };
          entry.params.sourceName = jobName;
          if (pe.target === 'enemy' || JOB_SKILL_ENEMY_KEYS.has(pe.key)) {
            defActive = addOrStackEffect(defActive, entry);
          } else if (pe.target === 'self' || JOB_SKILL_SELF_KEYS.has(pe.key)) {
            atkActive = addOrStackEffect(atkActive, entry);
          }
          skillApplied = true;
        }
        if (skillApplied) {
          const hasImmedHeal = (chosen.procEffects || []).some(pe => pe?.key === 'heal_over_time' && pe?.target === 'self');
          if (!hasImmedHeal) log.push(`✨ **(${jobName})** 發動【${chosen.name}】！${chosen.description || ''}`);
        }
      }
    }
  }

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
      case 'hit_down':
      case 'hit_rate_down':    hitBonus      -= Math.abs(v); break;
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
      case 'dodge_down':     defDodgeBonus -= Math.abs(v); break;
      case 'agi_down':       defDodgeBonus -= Math.abs(v) * 0.5; break;
      case 'invincible_short': damageRedPct += 100; break;
      case 'damage_taken_up': damageRedPct -= Math.abs(v); break; // 被動增傷（負減免）
      case 'final_damage_down': damageRedPct += Math.abs(v); break;
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

  const hitChance = calcHitChance({
    hit: atkStats.hit + hitBonus,
    dodge: defStats.dodge + defDodgeBonus,
    min: 30,
  });

  let killed = false;

  // ── 擲攻擊階級 ──
  const pkAtkTier = rollAttackTier(calcAttackTierProbs(atkStats.dex || 0, atkStats.luk || 0));

  // 大失敗：攻方自殘
  if (pkAtkTier === 'critFail') {
    const selfBase = Math.max(1, Math.round((atkStats.atk || 1) * (atkMultiplier || 1)));
    const selfDmg = Math.max(1, Math.round(selfBase * 0.3 * (0.7 + Math.random() * 0.3)));
    atkHpRef.value -= selfDmg;
    log.push(`💥 **${atkName} 大失敗**！揮拳失手砸到自己，受到 **${selfDmg}** 點傷害！`);
    if (atkHpRef.value <= 0) killed = true;
    return { killed, atkActive, defActive };
  }
  if (pkAtkTier === 'fail') {
    log.push(`❌ **${atkName} 失敗**！揮空了！`);
    return { killed, atkActive, defActive };
  }
  const pkForceHit = (pkAtkTier === 'great' || pkAtkTier === 'perfect');

  if (!pkForceHit && stunRoundsLeft <= 0 && Math.random() * 100 >= hitChance) {
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
          allowBlock: true,
        });
        if (strike.killed) killed = true;
      }
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
    if (defActive.some(e => e.key === 'poison' && effectIsActive(e, round))) {
      const bvp = atkActive.filter(e => e.key === 'bonus_vs_poisoned' && effectIsActive(e, round));
      for (const b of bvp) condBonus *= (1 + Math.abs(Number(b.params?.value ?? 0)) / 100);
    }
    // 矮人戰士：對暈眩目標增傷
    if (Number(atkStats.dwarfWarriorBonusVsStunnedPct) > 0) {
      const defIsStunned = defActive.some(e => e.key === 'stun' && effectIsActive(e, round));
      if (defIsStunned) condBonus *= (1 + Number(atkStats.dwarfWarriorBonusVsStunnedPct) / 100);
    }

    // 等級壓制
    const levelMult = pkLevelMult(atkStats.level, defStats.level);
    const attackBase = Math.max(1, Math.round(atkStats.atk * atkMultiplier * finalDmgMult * condBonus * levelMult));
    // 新公式：(ATK − defenderFlatDef) × (1 − finalDef/100)
    let dmg = rollDmg(pkApplyDefense(attackBase, defStats.flatDef || 0, finalDef, atkStats.atk));

    // ── 套攻擊階級乘數（成功 ×1.0 / 大成功 ×1.3；完美走爆擊另算）──
    const pkAtkTierMult = ATTACK_TIER_MULT[pkAtkTier] ?? 1.0;
    if (pkAtkTier !== 'perfect' && pkAtkTierMult !== 1.0) {
      dmg = Math.max(1, Math.round(dmg * pkAtkTierMult));
    }
    // ── 防禦階級擲骰 ──
    const pkDefTier = rollDefenseTier(calcDefenseTierProbs(defStats.dex || 0, defStats.luk || 0));
    const pkDefTierMult = DEFENSE_TIER_MULT[pkDefTier] ?? 1.0;
    if (pkDefTierMult !== 1.0) dmg = Math.max(1, Math.round(dmg * pkDefTierMult));

    let wasBlocked = false;
    let blockNote = "";
    if (defStats.blockChance > 0 && Math.random() * 100 < defStats.blockChance) {
      wasBlocked = true;
      blockNote = `，但 **${defName}** ${rand(BLOCK_PHRASES)}`;
    }

    let isCrit = false;

    const nonCritDamageBase = dmg;

    // 爆擊：完美 = 必爆擊；否則照爆擊率
    const effectiveCrit = Math.min(100, (atkStats.crit || 0) + critRateBonus);
    isCrit = (pkAtkTier === 'perfect') || (Math.random() * 100 < effectiveCrit);

    let finalDamage = dmg;
    if (isCrit) {
      const critMult = 2 * critDmgMult;
      const critPostDef = pkApplyDefense(attackBase, defStats.flatDef || 0, finalDef, atkStats.atk);
      finalDamage = Math.round(rollDmg(critPostDef) * critMult);
    }

    if (wasBlocked) {
      if (isCrit) {
        finalDamage = Math.max(1, Math.round(nonCritDamageBase));
        blockNote += `，因對手爆擊擊破防禦，改以未爆擊傷害計算！`;
      } else {
        finalDamage = 1;
        blockNote += `，傷害降至 **1**！`;
      }
    }

    // 防守方傷害減免（damage_reduction debuff）
    if (damageRedPct > 0) finalDamage = Math.max(1, Math.round(finalDamage * (1 - Math.min(95, damageRedPct) / 100)));
    finalDamage = applyInvincibleDamage(finalDamage, defActive, round);

    const capResult = applyRoundDamageCap({
      targetKey: defTargetKey,
      rawDamage: finalDamage,
      roundDamageState,
    });
    finalDamage = capResult.damage;
    defHpRef.value -= finalDamage;

    // 敘述
    const breakNote = isBreak ? "💥**破防**！" : "";
    const critNote = isCrit ? `✨**${rand(CRIT_PHRASES)}**！` : "";
    let pkAtkTierNote = "";
    if (pkAtkTier === 'great') pkAtkTierNote = "⚡**大成功**！";
    else if (pkAtkTier === 'perfect') pkAtkTierNote = "🌟**完美**！";
    let pkDefTierNote = "";
    if (pkDefTier === 'crushed') pkDefTierNote = " 💢被爆打";
    else if (pkDefTier === 'reduce') pkDefTierNote = " 🛡️減傷";
    else if (pkDefTier === 'graze') pkDefTierNote = " 🌬️擦傷";

    log.push(`⚔️ ${pkAtkTierNote}${critNote}${breakNote}**${atkName}** ${rand(atkVerbs)}${blockNote}，對 **${defName}** 造成 **${finalDamage}** 點傷害${pkDefTierNote}！（${defName} 剩 ${Math.max(0, defHpRef.value)} HP）`);
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
      // 同時支援 counter_attack（主動效果）和 counter（城牆衛兵卡等卡片效果）
      const reactiveCounterEffects = [
        ...getDefReactionEffects('counter_attack'),
        ...getDefReactionEffects('counter'),
      ];
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
      // 矮人戰士：高血量擊暈加成（HP > 60%）
      const dwarfStunBonus = (Number(atkStats.dwarfWarriorHighHpStunBoost) > 0 && atkHpRef.value >= Math.ceil((atkStats.maxHp || 1) * 0.60))
        ? Number(atkStats.dwarfWarriorHighHpStunBoost) : 0;
      const effectiveStun = (atkStats.stunChance || 0) + dwarfStunBonus;
      if (effectiveStun > 0 && Math.random() * 100 < effectiveStun) {
        const weaponStunDur = atkStats.stunDuration || 3;
        defActive = addOrStackEffect(defActive, {
          key: 'stun', params: { duration: { mode: 'turns', value: weaponStunDur } },
          appliedAt: round, sourceType: 'pvp_stun', sourceId: `${atkName}:stun`
        });
        log.push(`😵 **${defName}** ${rand(STUN_PHRASES)}！接下來 ${weaponStunDur} 回合無法攻擊！`);
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

        const procEffects = (Array.isArray(skill.procEffects) ? skill.procEffects : [])
          .filter((effect) => !effectHasHpThreshold(effect));
        if (procEffects.length === 0) continue;

        if (Number(skill.cooldownTurns) > 0) {
          if (!atkOpts._cardCooldowns) atkOpts._cardCooldowns = {};
          atkOpts._cardCooldowns[cooldownKey] = Number(skill.cooldownTurns);
        }

        const shouldShowGenericSkillLine = !procEffects.some((effect) => shouldSuppressImmediateLog(effect));
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
        const isImmediateDamage = shouldApplyAsImmediateDamage(pe);
        const duration = pe.duration || pp.duration;
        const entry = {
          key: pe.key,
          params: duration && !pp.duration ? { ...pp, duration } : { ...pp },
          stackMode: pe.stackMode,
          appliedAt: round,
          sourceType: 'pvp_card',
          sourceId: `${slot}:${slotItem.uuid || slotItem.itemId || cardName}`
        };
        entry.params.sourceName = atkName;
        // caster_atk_pct DOT 需要儲存施法者的實際 ATK，否則 tick 時 base=1
        if (!entry.params.casterAtk && entry.params.mode === 'caster_atk_pct') {
          entry.params.casterAtk = atkStats.atk;
        }
        if (shouldApplyAsImmediateHeal(pe)) {
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
        if (isImmediateDamage && (pe.target === 'enemy' || PK_CARD_OFFENSIVE_KEYS.has(pe.key))) {
          const immediateBase = pp.mode === 'caster_atk_pct'
            ? Math.max(1, atkStats.atk)
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
            rawDamage: applyInvincibleDamage(immediateDamage, defActive, round),
            damageLabel: label,
          });
          appliedAnyProc = true;
          if (defHpRef.value <= 0) {
            killed = true;
            break;
          }
          continue;
        }
        if (pe.target === 'enemy' || PK_CARD_OFFENSIVE_KEYS.has(pe.key)) {
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

    // ── 連擊 ─── 簡化：觸發後同一次傷害再扣一次（× 2 效果）
    if (!killed) {
      let comboChance = atkStats.combo;
      if (atkStats.hasRogueBadge && atkStats.weaponType === "dagger") comboChance = Math.min(80, comboChance + 10);
      if (Math.random() * 100 < comboChance) {
        let cdmg = Math.max(1, Math.round(finalDamage * (atkStats.comboDamageMultiplier || 1)));
        if (atkStats.hasRogueBadge && atkStats.weaponType === "dagger") cdmg = Math.round(cdmg * 1.1);
        cdmg = applyInvincibleDamage(cdmg, defActive, round);
        const capResult = applyRoundDamageCap({
          targetKey: defTargetKey,
          rawDamage: cdmg,
          roundDamageState,
        });
        cdmg = capResult.damage;
        defHpRef.value -= cdmg;
        log.push(`⚡ **${rand(COMBO_PHRASES)}** **${atkName}** 連擊！再造成 **${cdmg}** 點傷害！（${defName} 剩 ${Math.max(0, defHpRef.value)} HP）`);
        pushCappedNotice(log, defName, capResult.capped);
        if (defHpRef.value <= 0) killed = true;
      }
    }
  }  // close else (命中 branch)

  // 副手第二主攻機制已移除（2026-05-26）

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
  // 注入等級給戰鬥內部使用（等級壓制）
  aStats = { ...aStats, level: Math.max(1, Number(aOpts?.level || aStats?.level || 1)) };
  bStats = { ...bStats, level: Math.max(1, Number(bOpts?.level || bStats?.level || 1)) };
  const aHpRef = { value: aStats.maxHp };
  const bHpRef = { value: bStats.maxHp };
  let aActive  = Array.isArray(aOpts.activeEffects) ? [...aOpts.activeEffects] : [];
  let bActive  = Array.isArray(bOpts.activeEffects) ? [...bOpts.activeEffects] : [];
  const roundDamageState = createRoundDamageState(aStats, bStats);

  // 冷卻注入到 opts（card cooldowns + job skill cooldowns）
  aOpts._cardCooldowns = {};
  bOpts._cardCooldowns = {};
  aOpts._jobSkillCooldowns = {};
  bOpts._jobSkillCooldowns = {};

  const roundLogs = [];
  let winner = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const log = [`**【第 ${round} 回合】**`];
    roundDamageState.A.taken = 0;
    roundDamageState.B.taken = 0;
    roundDamageState.A.noticeShown = false;
    roundDamageState.B.noticeShown = false;

    // job skill 冷卻倒數
    for (const k of Object.keys(aOpts._jobSkillCooldowns)) aOpts._jobSkillCooldowns[k] = Math.max(0, aOpts._jobSkillCooldowns[k] - 1);
    for (const k of Object.keys(bOpts._jobSkillCooldowns)) bOpts._jobSkillCooldowns[k] = Math.max(0, bOpts._jobSkillCooldowns[k] - 1);
    aOpts._jobSkillUsed = false;
    bOpts._jobSkillUsed = false;

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
      // 副手反擊機制已移除（2026-05-26）
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
      // 副手反擊機制已移除（2026-05-26）
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
