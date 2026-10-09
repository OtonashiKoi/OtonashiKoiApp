"use strict";
const INTERVAL_MS = 20000, BUFF_MS = 15000;
const DESCRIPTION = "戰鬥開始立直，之後每20秒立直一次。50%自摸：全體共鬥成員AGI+15，持續15秒；自身立即追加四風連擊，每段30%攻擊力，共120%。未自摸：全體共鬥成員LUK+5，持續15秒；自身扣除當前HP的10%。BUFF依時間到期，換怪保留；同種增益不疊加。";
function hasCard(equipped) {
  return ["special_1", "special_2", "special_3"].some(slot => equipped?.[slot]?.monsterCardSkill?.key === "hutao_riichi");
}
function openingCard() {
  return { itemId: "hutao-riichi-pulse", monsterCardSkill: { key: "hutao_tsumo", name: "自摸", trigger: "riichi", chance: 100,
    procEffects: [{ key: "proc_chain_hit", target: "enemy", chance: 100, params: { chainCount: 4, damageMultiplier: .3 } }] } };
}
function timedStats(stats, buffs, now) {
  const agi = Number(buffs?.agiUntil) > now ? 15 : 0, luk = Number(buffs?.lukUntil) > now ? 5 : 0;
  if (!agi && !luk) return { ...stats };
  const next = { ...stats, agi: (Number(stats.agi) || 0) + agi, luk: (Number(stats.luk) || 0) + luk,
    dodge: Math.min(95, (Number(stats.dodge) || 0) + agi * .5), combo: Math.min(95, (Number(stats.combo) || 0) + agi * .5), crit: Math.min(95, (Number(stats.crit) || 0) + luk * .5) };
  const { getWeaponConfig } = require("./combatStats"), { effectiveOffensiveStat } = require("./offensiveStatCurve");
  const config = getWeaponConfig(stats.weaponType), delta = config?.baseStat === "agi" ? agi : config?.baseStat === "luk" ? luk : 0;
  if (delta) {
    const base = Number(stats[config.baseStat]) || 0;
    const gain = effectiveOffensiveStat(base + delta) - effectiveOffensiveStat(base);
    next.atk += Math.round(effectiveOffensiveStat(base + delta) * config.mult) - Math.round(effectiveOffensiveStat(base) * config.mult);
    next.weaponMainStatValue = (Number(stats.weaponMainStatValue) || 0) + gain;
  }
  return next;
}
module.exports = { INTERVAL_MS, BUFF_MS, DESCRIPTION, hasCard, openingCard, timedStats };
