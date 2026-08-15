"use strict";

// 世界王助攻的共用口徑。控制窗口本身不直接灌固定分；只有別的玩家在
// 窗口內實際完成戰鬥，才把其有效輸出的 10% 視為這次團隊控制的助攻池。
const CONTROL_WINDOW_ASSIST_PCT = 10;

const SUPPORT_EFFECT_KINDS = Object.freeze({
  heal_over_time: "healing",
  party_heal: "healing",
  party_damage_up: "damage",
  party_boss_damage_up: "damage",
  party_elite_damage_up: "damage",
  party_high_hp_damage_up: "damage",
  party_stunned_damage_up: "damage",
  party_monster_def_down: "defense_offense",
  party_def_ignore_up: "defense_offense",
  party_agi_up: "rate",
  party_combo_up: "rate",
  party_crit_rate_up: "rate",
  party_damage_reduction: "mitigation",
  party_crit_damage_reduction: "mitigation",
  party_max_hp_up: "survival_buffer",
  support_shot: "direct_damage",
  party_exp_gain_up: "reward_only",
  party_gold_gain_up: "reward_only",
});

function safeJobKey(value) {
  const key = String(value || "unknown").trim().replace(/[.$]/g, "_");
  return key || "unknown";
}

function normalizeContributorMap(raw, fallback = null) {
  const out = {};
  for (const [idRaw, rowRaw] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const id = String(idRaw || "").trim();
    if (!id) continue;
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : { amount: rowRaw };
    const amount = Math.max(0, Number(row.amount) || 0);
    if (!(amount > 0)) continue;
    out[id] = {
      amount,
      displayName: String(row.displayName || ""),
      jobId: String(row.jobId || ""),
      jobName: String(row.jobName || ""),
    };
  }
  if (Object.keys(out).length === 0 && fallback?.id) {
    out[String(fallback.id)] = {
      amount: Math.max(1, Number(fallback.amount) || 1),
      displayName: String(fallback.displayName || ""),
      jobId: String(fallback.jobId || ""),
      jobName: String(fallback.jobName || ""),
    };
  }
  return out;
}

function mergeContributorMaps(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [id, row] of Object.entries(normalizeContributorMap(map))) {
      const prev = out[id] || { amount: 0, displayName: "", jobId: "", jobName: "" };
      out[id] = {
        amount: prev.amount + row.amount,
        displayName: row.displayName || prev.displayName,
        jobId: row.jobId || prev.jobId,
        jobName: row.jobName || prev.jobName,
      };
    }
  }
  return out;
}

function supportEffectKind(key) {
  return SUPPORT_EFFECT_KINDS[String(key || "")] || null;
}

function directDamageAssistPot(totalDamage, valuePct) {
  const damage = Math.max(0, Number(totalDamage) || 0);
  const value = Math.max(0, Number(valuePct) || 0);
  return value > 0 ? damage * value / (100 + value) : 0;
}

// 部位剩餘 HP／事件血線可能讓本場「實際扣掉的王血」低於 combatLoop 原始輸出。
// 直接傷害來源必須一起等比例縮放，避免神射手箭傷加回提供者後超過王真正失去的 HP。
function allocateDirectDamage(effectiveTotalRaw, rawTotalRaw, bySourceRaw = {}) {
  const effectiveTotal = Math.max(0, Math.round(Number(effectiveTotalRaw) || 0));
  const rawTotal = Math.max(0, Number(rawTotalRaw) || 0);
  const sources = Object.entries(bySourceRaw || {})
    .map(([id, value]) => [String(id || ""), Math.max(0, Number(value) || 0)])
    .filter(([id, value]) => id && value > 0);
  const rawSupport = sources.reduce((sum, [, value]) => sum + value, 0);
  const categories = [
    ["__self__", Math.max(0, rawTotal - rawSupport)],
    ...sources,
  ].filter(([, value]) => value > 0);
  const denominator = categories.reduce((sum, [, value]) => sum + value, 0);
  if (!(effectiveTotal > 0) || !(denominator > 0)) {
    return { selfDamage: effectiveTotal, bySource: {}, sourceTotal: 0 };
  }

  const shares = categories.map(([id, value]) => {
    const exact = effectiveTotal * value / denominator;
    return { id, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = effectiveTotal - shares.reduce((sum, row) => sum + row.amount, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  for (let i = 0; i < shares.length && left > 0; i++, left--) shares[i].amount += 1;

  const bySource = {};
  let selfDamage = 0;
  for (const row of shares) {
    if (row.id === "__self__") selfDamage += row.amount;
    else if (row.amount > 0) bySource[row.id] = row.amount;
  }
  const sourceTotal = Object.values(bySource).reduce((sum, value) => sum + value, 0);
  return { selfDamage, bySource, sourceTotal };
}

function mirrorDamageToOtherParts(partsHpRaw, targetPart, damagePerPartRaw) {
  const partsHp = { ...(partsHpRaw || {}) };
  const damagePerPart = Math.max(0, Math.round(Number(damagePerPartRaw) || 0));
  let total = 0;
  if (!(damagePerPart > 0)) return { partsHp, total };
  for (const partKey of Object.keys(partsHp)) {
    if (partKey === targetPart) continue;
    const currentHp = Math.max(0, Number(partsHp[partKey]) || 0);
    if (!(currentHp > 0)) continue;
    const dealt = Math.min(currentHp, damagePerPart);
    partsHp[partKey] = currentHp - dealt;
    total += dealt;
  }
  return { partsHp, total };
}

// 以目前戰鬥使用的百分比防禦模型反推「拿掉隊伍破防／穿防後」會少掉多少傷害。
// flatDef 已在每一擊前處理，這裡只估算百分比防禦層，避免把 10% 破防誤當 10% 終傷。
function defenseOffenseAssistPot({ totalDamage, monsterDefPct, selfBypassPct = 0, partyDefDownPct = 0, partyDefIgnorePct = 0 } = {}) {
  const damage = Math.max(0, Number(totalDamage) || 0);
  const def = Math.max(0, Math.min(95, Number(monsterDefPct) || 0));
  const selfBypass = Math.max(0, Math.min(95, Number(selfBypassPct) || 0));
  const down = Math.max(0, Math.min(95, Number(partyDefDownPct) || 0));
  const ignore = Math.max(0, Math.min(95, Number(partyDefIgnorePct) || 0));
  if (!(damage > 0) || (!(down > 0) && !(ignore > 0)) || !(def > 0)) return 0;

  const withoutPartyDef = def * (1 - selfBypass / 100);
  const withPartyDef = def * (1 - down / 100) * (1 - Math.min(95, selfBypass + ignore) / 100);
  const withoutMult = Math.max(0.05, 1 - withoutPartyDef / 100);
  const withMult = Math.max(0.05, 1 - withPartyDef / 100);
  if (withMult <= withoutMult) return 0;
  return damage * (1 - withoutMult / withMult);
}

module.exports = {
  CONTROL_WINDOW_ASSIST_PCT,
  SUPPORT_EFFECT_KINDS,
  safeJobKey,
  normalizeContributorMap,
  mergeContributorMaps,
  supportEffectKind,
  directDamageAssistPot,
  allocateDirectDamage,
  mirrorDamageToOtherParts,
  defenseOffenseAssistPot,
};
