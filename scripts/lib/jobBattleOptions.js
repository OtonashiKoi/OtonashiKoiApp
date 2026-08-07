"use strict";
/**
 * 職業戰鬥參數的**單一來源** —— 所有平衡腳本都要走這裡，不准自己手拼 options。
 *
 * 為什麼要有這支（2026-08-05）：
 *   平衡腳本各自手拼 runCombatLoop 的 options，導致同一類漏接反覆發生：
 *     ① eco 漏帶自我光環 → 光環職業被低估（早先修掉）
 *     ② simWorldBoss 漏帶自我光環 → 同一個坑（2026-08-05 修）
 *     ③ balance-job-real-zones 漏帶自我光環 → 又一次（2026-08-05 修）
 *     ④ simWorldBoss / real-zones **完全沒餵任何職業身分技**（殘影亂舞、戰意、
 *        血祭、計謀值、震盪值、命運骰、演奏、日之精靈、區域連段…）→ 所有終局王排行
 *        的二轉職業都是「沒放技能」的數字。
 *   combatLoop 讀 54 個 options，simWorldBoss 只餵 12、real-zones 只餵 10、eco 餵 25。
 *   → 把「徽章有什麼機制」與「要餵哪些參數」綁在一起，並提供覆蓋檢查（見 auditCoverage）。
 *
 * 使用方式：
 *   const jbo = require("./jobBattleOptions");
 *   const opts = jbo.buildBattleOptions({ equipped, pStats, inventory, ctx });
 *   runCombatLoop(pStats, ..., { ...baseOpts, ...opts });
 *
 * ctx 是「跨場狀態」容器（氣條/精靈血量等會跨場沿用的東西），由呼叫端持有並在場與場之間傳遞。
 * 不傳 ctx 就用「滿格」預設＝量測職業的**完整實力**（技能都放得出來的情況）。
 */
const jobAdvancement = require("../../src/shared/jobAdvancement");
const { collectEquipmentEffects } = require("../../src/shared/effectEngine");
const { scaleSupportPartyEffects } = require("../../src/shared/supportAuraScaling");
const shadowGauge = require("../../src/shared/shadowGauge");

/**
 * 徽章機制 → combatLoop options 的對應表。
 * 新增二轉機制時**一定要在這裡加一列**，否則 auditCoverage 會報錯。
 */
const MECHANIC_MAP = [
  { name: "殘影亂舞",   detect: (b) => shadowGauge.hasGauge(b),          options: ["shadowGaugeGrids"] },
  { name: "氣力・斬",   detect: (b) => hasOniGauge(b),                    options: ["oniGaugeGrids"] },
  { name: "戰意全開",   detect: (b) => !!jobAdvancement.getGauge?.(b),    options: ["warGaugeCritBonus"] },
  { name: "血祭",       detect: (b) => !!jobAdvancement.getSacrifice?.(b), options: ["sacrificeHpCostPct", "sacrificeAtkUpPct"] },
  { name: "日之精靈",   detect: (b) => !!jobAdvancement.getSunSpirit?.(b), options: ["sunSpiritHpPct"] },
  { name: "掩護射擊",   detect: (b) => !!jobAdvancement.getSniper?.(b),    options: ["sniperGaugeGrids"] },
  { name: "計謀值",     detect: (b) => !!jobAdvancement.getSage?.(b),      options: ["sageGaugeGrids"] },
  { name: "命運骰",     detect: (b) => !!jobAdvancement.getDiceGod?.(b),   options: ["diceGaugeGrids", "diceLuckStacks"] },
  { name: "演奏・和弦", detect: (b) => hasBardSong(b),                     options: ["bardDamageMult", "bardChordPct"] },
  { name: "戰鬥姿態",   detect: (b) => !!jobAdvancement.getStances?.(b),   options: ["stance"] },
];

/**
 * 這些機制 combatLoop 是直接從 `options.equipped.job_eq` 推導的，**不需要另外餵參數**，
 * 列在這裡是為了讓覆蓋報告看得到它們「有被涵蓋」，不會被誤判成漏接：
 *   ・巨神震擊（矮人戰士長 getStunMastery）——自身暈眩精通從裝備推導；
 *     `options.teamStunRounds` 是「別的矮人給的暈眩」＝環境參數，不是自己的機制
 *   ・得手（盜靈 getSpiritThief）
 *   ・聖域（聖域師 getSanctum）——護盾值 = maxHp×% + INT×係數，全部從裝備算
 *   ・區域冰凍值（元素師凍霜）——累積在呼叫端，戰鬥內不需要參數
 */
const EQUIPPED_DERIVED = [
  { name: "巨神震擊", detect: (b) => !!jobAdvancement.getStunMastery?.(b) },
  { name: "得手",     detect: (b) => !!jobAdvancement.getSpiritThief?.(b) },
  { name: "聖域",     detect: (b) => !!jobAdvancement.getSanctum?.(b) },
];

function hasOniGauge(badge) {
  try {
    const br = jobAdvancement.getT2Branch(String(badge?.itemId || badge?.id || ""));
    return !!(br && br.combo);
  } catch (_) { return false; }
}
function hasBardSong(badge) {
  try { return require("../../src/shared/bardSong").hasSong(badge); } catch (_) { return false; }
}

/** 這些是「所有職業都吃得到」的環境參數，與徽章無關，但一樣不能漏 */
const ENVIRONMENT_OPTIONS = ["partyEffects", "zoneComboCount"];

function badgeId(equippedOrBadge) {
  const b = equippedOrBadge?.job_eq || equippedOrBadge;
  return String(b?.itemId || b?.id || "");
}

/** 自己的隊伍光環：正式環境是 allParticipantsWithSelf，自己一定在參戰者名單裡 */
function buildSelfAuras(equipped, pStats, inventory = []) {
  try {
    const raw = (collectEquipmentEffects(equipped, "passive", { equipped, inventory }) || [])
      .filter((e) => e && e.target === "party")
      .map((e) => ({ ...e, isSelfAura: true, sourceName: "自己", sourceJobName: e.srcItem || "" }));
    if (!raw.length) return null;
    return scaleSupportPartyEffects(raw, { providerStats: pStats, equipped });
  } catch (_) {
    return null;
  }
}

/** 這個徽章有哪些機制（給報告/檢查用） */
function detectMechanics(equipped) {
  const badge = equipped?.job_eq || equipped;
  if (!badge) return [];
  return MECHANIC_MAP.filter((m) => { try { return m.detect(badge); } catch (_) { return false; } });
}

/**
 * 組出這個 build 的完整戰鬥參數。
 * @param {object}  p.equipped   裝備（含 job_eq）
 * @param {object}  p.pStats     已算好的玩家數值（自我光環的縮放要用）
 * @param {Array}   p.inventory
 * @param {object}  p.ctx        跨場狀態；不給就用「技能放得出來」的滿格預設
 * @param {string}  p.stance     指定姿態（沒給就用徽章預設）
 */
function buildBattleOptions({ equipped, pStats, inventory = [], ctx = null, stance = null } = {}) {
  const badge = equipped?.job_eq || null;
  const opts = {};

  // ── 環境：自我光環 + 區域連段 ──
  const auras = buildSelfAuras(equipped, pStats, inventory);
  if (auras) opts.partyEffects = auras;
  opts.zoneComboCount = ctx?.zoneComboCount ?? 0;

  if (!badge) return opts;

  // ── 影舞者：殘影亂舞（氣條） ──
  // 影襲已於 2026-08-05 移除，只剩殘影亂舞（氣條滿格 → 下一回合固定連擊）
  if (shadowGauge.hasGauge(badge)) {
    opts.shadowGaugeGrids = ctx?.shadowGrids ?? shadowGauge.GAUGE_MAX;   // 預設滿格 → 殘影亂舞
  }
  // ── 狂戰士：戰意全開 ──
  const gauge = safe(() => jobAdvancement.getGauge(badge));
  if (gauge) opts.warGaugeCritBonus = ctx?.warGaugeCritBonus ?? (Number(gauge.critRateBonus) || 30);
  // ── 狂戰士：血祭 ──
  const sac = safe(() => jobAdvancement.getSacrifice(badge));
  if (sac) {
    opts.sacrificeHpCostPct = ctx?.sacrificeHpCostPct ?? (Number(sac.hpCostPct) || 30);
    opts.sacrificeAtkUpPct = ctx?.sacrificeAtkUpPct ?? (Number(sac.atkUpPct) || 25);
  }
  // ── 聖靈師：日之精靈（跨場血量沿用；預設滿血在場） ──
  if (safe(() => jobAdvancement.getSunSpirit(badge))) opts.sunSpiritHpPct = ctx?.spiritPct ?? 100;
  // ── 神射手：震盪值 ──
  const sniper = safe(() => jobAdvancement.getSniper(badge));
  if (sniper) opts.sniperGaugeGrids = ctx?.sniperGrids ?? (Number(sniper.gaugeMax) || 5);
  // ── 兵聖：計謀值 ──
  const sage = safe(() => jobAdvancement.getSage(badge));
  if (sage) opts.sageGaugeGrids = ctx?.sageGrids ?? (Number(sage.gaugeMax) || 5);
  // ── 賭神：命運骰 ──
  const dice = safe(() => jobAdvancement.getDiceGod(badge));
  if (dice) {
    opts.diceGaugeGrids = ctx?.diceGrids ?? (Number(dice.gaugeMax) || 5);
    opts.diceLuckStacks = ctx?.diceLuck ?? 0;
  }
  // ── 劍鬼：氣力・斬（跨場沿用；預設滿格＝第 1 回合就斬） ──
  if (hasOniGauge(badge)) {
    const zc = safe(() => require("../../src/shared/zoneCombo"));
    opts.oniGaugeGrids = ctx?.oniGrids ?? (Number(zc?.ONI_GAUGE_MAX) || 3);
  }
  // ── 吟遊詩人：演奏倍率＋開場完美和弦 ──
  if (hasBardSong(badge)) {
    const bs = safe(() => require("../../src/shared/bardSong"));
    // 預設用「連奏 streak 0 的倍率」＋完美和弦 100%＝玩家有正常演奏的情況
    opts.bardDamageMult = ctx?.bardMult ?? (Number(safe(() => bs.auraMult(ctx?.bardStreak ?? 0))) || 1);
    opts.bardChordPct = ctx?.bardChordPct ?? 100;
  }
  // ── 姿態 ──
  const stances = safe(() => jobAdvancement.getStances(badge));
  if (stances) opts.stance = stance || ctx?.stance || safe(() => jobAdvancement.getDefaultStance(badge));

  return opts;
}

function safe(fn) { try { return fn(); } catch (_) { return null; } }

/**
 * 覆蓋檢查：這個 build 的每個機制，是不是都有對應的 option 被餵進去。
 * @returns {{ok:boolean, missing:Array<{mechanic:string,option:string}>}}
 */
function auditCoverage(equipped, builtOptions) {
  const missing = [];
  for (const m of detectMechanics(equipped)) {
    for (const key of m.options) {
      if (builtOptions[key] === undefined) missing.push({ mechanic: m.name, option: key });
    }
  }
  for (const key of ENVIRONMENT_OPTIONS) {
    if (builtOptions[key] === undefined && key !== "partyEffects") {
      missing.push({ mechanic: "環境", option: key });
    }
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  MECHANIC_MAP, ENVIRONMENT_OPTIONS, EQUIPPED_DERIVED,
  buildSelfAuras, detectMechanics, buildBattleOptions, auditCoverage, badgeId,
};
