"use strict";
const { HELLFANG_ZONE } = require("./zoneBattleState");
const { TURTLE_ZONE } = require("./zoneBattleState");
const { HUTAO_PREVIEW_ZONE } = require("./zoneBattleState");
const { DRAGON_KING_ZONE } = require("./zoneBattleState");
const { BTN } = require("./zoneBattleState");
const { WORLD_BOSS_TARGET_PARTS } = require("./zoneBattleState");
const { getWorldBossPartLabel } = require("../../shared/worldBossParts");
const { HELLFANG_FRENZY_DODGE_BONUS } = require("./zoneBattleState");
const { HELLFANG_FRENZY_DMG_MULT } = require("./zoneBattleState");
const { HELLFANG_PART_WEAKNESS } = require("./zoneBattleState");
const { HELLFANG_CORE_PLAYER_MULT } = require("./zoneBattleState");
const { HELLFANG_WRONG_TYPE_MULT } = require("./zoneBattleState");
const { HELLFANG_FLIP_FRACTION } = require("./zoneBattleState");
const { HELLFANG_FLIP_DURATION_MS } = require("./zoneBattleState");
const { HELLFANG_PART_LABELS } = require("./zoneBattleState");

function getWorldBossPartKeys(zoneKey) {
  if (zoneKey === HELLFANG_ZONE) return ["head", "upper_body", "lower_body", "tail", "legs"];
  if (zoneKey === TURTLE_ZONE) return ["head", "body", "wings", "legs"]; // 龜首/島背/左鰭/右鰭
  if (zoneKey === HUTAO_PREVIEW_ZONE) return ["body"];
  return zoneKey === DRAGON_KING_ZONE ? ["head", "body", "wings", "legs"] : ["head", "body", "legs"];
}

function parseWorldBossTargetPart(customId) {
  const raw = String(customId || "");
  if (!raw.startsWith(BTN.enterBattlePrefix)) return "body";
  const part = raw.slice(BTN.enterBattlePrefix.length);
  return WORLD_BOSS_TARGET_PARTS.has(part) ? part : "body";
}

function getWorldBossTargetProfile(part, zoneKey = null) {
  // 島島龜王：難度全由潮汐/海嘯機制驅動（turtleTide.battleMods），部位本身不加料
  if (zoneKey === TURTLE_ZONE) {
    return { label: getWorldBossPartLabel(zoneKey, part) };
  }
  if (zoneKey === HUTAO_PREVIEW_ZONE) {
    return { label: getWorldBossPartLabel(zoneKey, part) };
  }
  // 古龍王:採破鱗削弱(破部位永久削弱),攻擊當下不另加難度,只回部位標籤
  if (zoneKey === DRAGON_KING_ZONE || part === "wings") {
    const labels = { head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤" };
    return { label: labels[part] || "軀幹" };
  }
  if (part === "head") {
    // 頭部：怪物技能發動率提高（高風險，技能更常觸發）
    return {
      label: "頭部",
      monsterSkillChanceBonus: 25,   // 怪物卡技能觸發率 +25%
      note: "⚠️ 怪物技能發動率大幅提高（高風險）"
    };
  }
  if (part === "legs") {
    // 下盤/尾巴：怪物攻擊更兇，終傷 ×1.3
    return {
      label: "下盤",
      monsterDamageMult: 1.3,        // 怪物終傷 ×1.3
      note: "⚠️ 怪物攻擊更兇（你受到的傷害 ×1.3）"
    };
  }
  // 軀幹：防禦更高，且你的傷害被削減
  return {
    label: "軀幹",
    monsterFlatDefMult: 1.6,         // 固定防禦提高（不受 75% 上限限制）
    playerAtkMultiplier: 0.8,        // 玩家傷害 -20%（實際透過 atk 折減，確實生效）
    note: "🛡️ 防禦極高、你的傷害被削減"
  };
}

function applyWorldBossTargetToPlayerStats(playerStats, part, zoneKey = null) {
  const profile = getWorldBossTargetProfile(part, zoneKey);
  const next = { ...(playerStats || {}) };
  if (profile.playerAtkMultiplier != null) {
    next.atk = Math.max(1, Math.round((next.atk || 0) * profile.playerAtkMultiplier));
  }
  if (profile.playerDexMultiplier != null) {
    next.dex = Math.max(1, Math.round((next.dex || 1) * profile.playerDexMultiplier));
  }
  if (profile.playerAgiBonus != null) {
    next.agi = Math.max(1, Math.round((next.agi || 1) + profile.playerAgiBonus));
  }
  return { stats: next, profile };
}

function applyWorldBossTargetToMonster(monsterStats, monsterEquipped, part, zoneKey = null) {
  const profile = getWorldBossTargetProfile(part, zoneKey);
  const mStats = { ...(monsterStats || {}) };
  let mEquip = monsterEquipped || {};

  if (profile.monsterFlatDefMult) {
    mStats.flatDef = Math.max(0, Math.round((Number(mStats.flatDef) || 0) * profile.monsterFlatDefMult));
  }
  if (profile.monsterDamageMult) {
    mStats.atk = Math.max(1, Math.round((Number(mStats.atk) || 1) * profile.monsterDamageMult));
  }
  if (profile.monsterSkillChanceBonus) {
    // clone special_1 卡，提高 monsterCardSkill.chance
    mEquip = { ...mEquip };
    const card = mEquip.special_1;
    if (card && card.monsterCardSkill) {
      const skill = { ...card.monsterCardSkill };
      skill.chance = Math.min(100, (Number(skill.chance) || 30) + profile.monsterSkillChanceBonus);
      mEquip.special_1 = { ...card, monsterCardSkill: skill, cardProcChance: skill.chance };
    }
  }
  return { monsterStats: mStats, monsterEquipped: mEquip, profile };
}

function createWorldBossPartHpTemplate(totalMaxHp = 0, zoneKey = null) {
  const maxHp = Math.max(1, Math.round(Number(totalMaxHp) || 1));
  if (zoneKey === HUTAO_PREVIEW_ZONE) return { body: maxHp };
  if (zoneKey === HELLFANG_ZONE) {
    // 牙狼 5 部位：頭 20% / 上軀幹 20% / 下軀幹 20% / 尾巴 15% / 腿 25%
    const head = Math.max(1, Math.round(maxHp * 0.20));
    const upper_body = Math.max(1, Math.round(maxHp * 0.20));
    const lower_body = Math.max(1, Math.round(maxHp * 0.20));
    const tail = Math.max(1, Math.round(maxHp * 0.15));
    const legs = Math.max(1, maxHp - head - upper_body - lower_body - tail);
    return { head, upper_body, lower_body, tail, legs };
  }
  if (zoneKey === DRAGON_KING_ZONE) {
    // 古龍王 4 部位:頭 30% / 軀幹 30% / 龍翼 20% / 下盤 20%
    const head = Math.max(1, Math.round(maxHp * 0.3));
    const body = Math.max(1, Math.round(maxHp * 0.3));
    const wings = Math.max(1, Math.round(maxHp * 0.2));
    const legs = Math.max(1, maxHp - head - body - wings);
    return { head, body, wings, legs };
  }
  if (zoneKey === TURTLE_ZONE) {
    // 島島龜王 4 部位:龜首 25% / 島背 40%(就是一座島) / 左鰭 17.5% / 右鰭 17.5%
    const head = Math.max(1, Math.round(maxHp * 0.25));
    const body = Math.max(1, Math.round(maxHp * 0.4));
    const wings = Math.max(1, Math.round(maxHp * 0.175));
    const legs = Math.max(1, maxHp - head - body - wings);
    return { head, body, wings, legs };
  }
  const head = Math.max(1, Math.round(maxHp * 0.3));
  const body = Math.max(1, Math.round(maxHp * 0.4));
  const legs = Math.max(1, maxHp - head - body);
  return { head, body, legs };
}

function hellfangPlayerSchool(weaponType) {
  const wt = String(weaponType || "").toLowerCase();
  return wt.startsWith("staff") || wt === "dice" ? "magic" : "physical";
}

function hellfangAlivePartCount(state) {
  const hp = state?.worldBossPartsHp;
  if (!hp || typeof hp !== "object") return 5;
  return getWorldBossPartKeys(HELLFANG_ZONE).filter((k) => Number(hp[k] || 0) > 0).length;
}

function hellfangBossPhaseMods(state) {
  const alive = hellfangAlivePartCount(state);
  if (alive === 3 || alive === 2) return { dodgeBonus: HELLFANG_FRENZY_DODGE_BONUS, dmgMult: HELLFANG_FRENZY_DMG_MULT, phase: "frenzy", alive };
  return { dodgeBonus: 0, dmgMult: 1, phase: alive <= 1 ? "core" : "normal", alive };
}

function getWorldBossPartWeakness(zoneKey, partKey, state = null, now = Date.now()) {
  if (zoneKey !== HELLFANG_ZONE) return null;
  if (hellfangAlivePartCount(state) <= 1) return null; // 最終核心：物法皆可，不標弱點
  return hellfangPartCurrentWeak(state, partKey, now);
}

function getHellfangFlipRemainingMs(state, partKey, now = Date.now()) {
  const until = state?.hellfangFlipUntil?.[partKey] ? Date.parse(state.hellfangFlipUntil[partKey]) : 0;
  return (Number.isFinite(until) && until > now) ? (until - now) : 0;
}

function hellfangPartCurrentWeak(state, part, now = Date.now()) {
  const until = state?.hellfangFlipUntil?.[part] ? Date.parse(state.hellfangFlipUntil[part]) : 0;
  if (Number.isFinite(until) && until > 0 && now < until && state?.hellfangFlipWeak?.[part]) return state.hellfangFlipWeak[part];
  return HELLFANG_PART_WEAKNESS[part] || "physical";
}

function hellfangDamageMult(state, part, weaponType, now = Date.now()) {
  const school = hellfangPlayerSchool(weaponType);
  if (hellfangAlivePartCount(state) <= 1) return { school, weak: null, mult: HELLFANG_CORE_PLAYER_MULT };
  const weak = hellfangPartCurrentWeak(state, part, now);
  const mult = (school === weak) ? 1 : HELLFANG_WRONG_TYPE_MULT;
  return { school, weak, mult };
}

function hellfangPartAccrue(state, part, partMaxHp, school, effDamage, now = Date.now()) {
  if (!state || !part) return null;
  // ⚠️ 舊機制曾把 hellfangDmgPhys/Magic 存成「數字」(全王累積總傷)；新機制要當「每部位 map」。
  // 若殘留舊值(number)直接用 `|| {}` 會保留數字→`number[part]=` 拋「Cannot create property on number」，
  // settlement 整個失敗→傷害寫不進部位→玩家看到「打了沒傷害」。故一律強制轉物件。
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  state.hellfangDmgPhys = asObj(state.hellfangDmgPhys);
  state.hellfangDmgMagic = asObj(state.hellfangDmgMagic);
  state.hellfangFlipUntil = asObj(state.hellfangFlipUntil);
  state.hellfangFlipWeak = asObj(state.hellfangFlipWeak);
  state.hellfangFlipped = asObj(state.hellfangFlipped);
  const eff = Math.max(0, Number(effDamage) || 0);
  if (school === "magic") state.hellfangDmgMagic[part] = (state.hellfangDmgMagic[part] || 0) + eff;
  else state.hellfangDmgPhys[part] = (state.hellfangDmgPhys[part] || 0) + eff;
  const phys = state.hellfangDmgPhys[part] || 0;
  const magic = state.hellfangDmgMagic[part] || 0;
  // 最終核心(剩1部位)：不再翻面(物法皆可、不再變化)
  if (hellfangAlivePartCount(state) <= 1) return null;
  if (!state.hellfangFlipped[part] && (phys + magic) >= (Number(partMaxHp) || 0) * HELLFANG_FLIP_FRACTION) {
    const majority = phys >= magic ? "physical" : "magic";           // 你用比較多的那系
    const newWeak = majority === "physical" ? "magic" : "physical";  // 翻成抵禦該系(弱點變另一種)
    state.hellfangFlipWeak[part] = newWeak;
    state.hellfangFlipUntil[part] = new Date(now + HELLFANG_FLIP_DURATION_MS).toISOString();
    state.hellfangFlipped[part] = true;
    return { part, majority, newWeak };
  }
  return null;
}

function hellfangFlipLines(event) {
  if (!event) return [];
  const label = HELLFANG_PART_LABELS[event.part] || "部位";
  const resistZh = event.majority === "magic" ? "法術" : "物理";
  const newWeakZh = event.newWeak === "magic" ? "法術" : "物理";
  return [`🔁 地獄狼牙王的【${label}】適應了攻勢——改為抵禦${resistZh}傷害！此部位弱點暫時轉為【${newWeakZh}】（10 分鐘後復原、之後不再變）`];
}

function sumWorldBossPartHp(partsHp) {
  if (!partsHp || typeof partsHp !== "object") return 0;
  return Object.keys(partsHp).reduce((sum, k) => sum + Math.max(0, Number(partsHp[k] || 0)), 0);
}

function isWorldBossAllPartsDefeated(partsHp) {
  if (!partsHp || typeof partsHp !== "object") return false;
  const keys = Object.keys(partsHp);
  if (keys.length === 0) return false;
  return keys.every((k) => Number(partsHp[k] || 0) <= 0);
}

function applyDragonKingBreakWeaken(monsterStats, monsterEquipped, partsHp) {
  const mStats = { ...(monsterStats || {}) };
  let mEquip = monsterEquipped || {};
  const broken = (k) => Number((partsHp || {})[k] ?? 1) <= 0;

  if (broken("legs")) {
    mStats.atk = Math.max(1, Math.round((Number(mStats.atk) || 1) * 0.8)); // 普攻 −20%
  }
  const card = mEquip.special_1;
  if ((broken("wings") || broken("body")) && card && card.monsterCardSkill) {
    mEquip = { ...mEquip };
    const skill = { ...card.monsterCardSkill };
    if (broken("body")) {
      skill.chance = Math.min(Number(skill.chance) || 50, 30); // 發動率 → 30%
    }
    if (broken("wings") && Array.isArray(skill.procEffects)) {
      // 技能傷害 −15%(雷擊 value × 0.85)
      skill.procEffects = skill.procEffects.map((pe) =>
        pe && pe.key === "lightning"
          ? { ...pe, params: { ...(pe.params || {}), value: Math.max(1, Math.round((Number(pe.params?.value) || 0) * 0.85)) } }
          : pe
      );
    }
    mEquip.special_1 = { ...card, monsterCardSkill: skill, cardProcChance: skill.chance };
  }
  return { monsterStats: mStats, monsterEquipped: mEquip };
}

function ensureWorldBossPartState(state, monsterMaxHp, zoneKey = null) {
  const defaultMax = createWorldBossPartHpTemplate(monsterMaxHp, zoneKey);
  const hasCurrentHp = !!(state && state.worldBossPartsHp && typeof state.worldBossPartsHp === "object" && Object.keys(state.worldBossPartsHp).length);
  // 部位清單:沿用既有 state(自動支援 3 / 4 部位),否則用該區模板
  const keys = hasCurrentHp ? Object.keys(state.worldBossPartsHp) : Object.keys(defaultMax);
  const maxSrc = (state && state.worldBossPartsMaxHp && typeof state.worldBossPartsMaxHp === "object") ? state.worldBossPartsMaxHp : null;
  const currentMax = Object.fromEntries(keys.map((k) => [k, Math.max(1, Number((maxSrc && maxSrc[k]) || defaultMax[k] || 1))]));
  const currentHp = hasCurrentHp
    ? Object.fromEntries(keys.map((k) => [k, Math.max(0, Number(state.worldBossPartsHp[k] || 0))]))
    : { ...currentMax };

  const totalHp = sumWorldBossPartHp(currentHp);
  const changed = !hasCurrentHp || !state?.worldBossPartsMaxHp || Number(state?.currentHp) !== totalHp;
  return {
    worldBossPartsHp: currentHp,
    worldBossPartsMaxHp: currentMax,
    currentHp: totalHp,
    changed
  };
}

function freshHellfangFields() {
  return { hellfangFlipUntil: {}, hellfangFlipWeak: {}, hellfangFlipped: {}, hellfangDmgPhys: {}, hellfangDmgMagic: {} };
}

function applyWorldBossPhaseModifiers(monsterStats, phase) {
  if (!monsterStats || !phase) return monsterStats;
  return {
    ...monsterStats,
    atk: Math.max(1, Math.round((monsterStats.atk || 0) * Math.max(0.1, Number(phase.atkMultiplier || 1)))),
    def: Math.max(0, Math.min(75, (monsterStats.def || 0) * Math.max(0.1, Number(phase.defMultiplier || 1))))
  };
}
module.exports = { getWorldBossPartKeys, parseWorldBossTargetPart, getWorldBossTargetProfile, applyWorldBossTargetToPlayerStats, applyWorldBossTargetToMonster, createWorldBossPartHpTemplate, hellfangPlayerSchool, hellfangAlivePartCount, hellfangBossPhaseMods, getWorldBossPartWeakness, getHellfangFlipRemainingMs, hellfangPartCurrentWeak, hellfangDamageMult, hellfangPartAccrue, hellfangFlipLines, sumWorldBossPartHp, isWorldBossAllPartsDefeated, applyDragonKingBreakWeaken, ensureWorldBossPartState, freshHellfangFields, applyWorldBossPhaseModifiers };
