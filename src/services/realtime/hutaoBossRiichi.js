"use strict";
const { calculateBattleTickMs } = require("../../shared/battleTiming");
const cardRules = require("../../shared/hutaoRiichiCard");
const INTERVAL_MS = 15000, EFFECT_MS = 15000, STRIKE_MULTIPLIER = 3;
function initialize(state, at) {
  return state.normalLive.hutaoBossRiichi ||= { nextAt: at + INTERVAL_MS };
}
// One shared roll, committed with all recipients' HP by the live-room CAS.
// Missed time slots are skipped; joining and reviving never reset this clock.
function claim(state, at, enemy, controlled, random = Math.random) {
  const current = initialize(state, at);
  if (!enemy || at < current.nextAt) return null;
  current.nextAt += (Math.floor((at - current.nextAt) / INTERVAL_MS) + 1) * INTERVAL_MS;
  if (controlled) return null;
  const roll = random(), outcome = roll < .5 ? "tsumo" : roll < .75 ? "strike" : "deal-in";
  const cast = { id: `hutao-riichi-${state.normalLive.encounterKey || state.normalLiveSpawnAt}-${at}`, at, outcome };
  current.lastCast = cast;
  if (outcome === "tsumo") for (const actor of Object.values(state.normalLive.actors)) {
    if (actor.active && actor.hp > 0) actor.hutaoSlowUntil = at + EFFECT_MS;
  }
  if (outcome === "deal-in") current.enragedUntil = at + EFFECT_MS;
  return cast;
}
function playerStats(stats, actor, at) {
  if (!(Number(actor?.hutaoSlowUntil) > at)) return { ...stats };
  const delta = Math.min(30, Math.max(0, Number(stats.agi) || 0));
  const next = { ...stats, agi: (Number(stats.agi) || 0) - delta,
    dodge: Math.max(0, (Number(stats.dodge) || 0) - delta * .5),
    combo: Math.max(0, (Number(stats.combo) || 0) - delta * .5) };
  const { getWeaponConfig } = require("../../shared/combatStats");
  const { effectiveOffensiveStat } = require("../../shared/offensiveStatCurve");
  const config = getWeaponConfig(stats.weaponType);
  if (config?.baseStat === "agi") {
    const before = effectiveOffensiveStat(stats.agi), after = effectiveOffensiveStat(next.agi);
    next.atk = Math.max(0, next.atk + Math.round(after * config.mult) - Math.round(before * config.mult));
    next.weaponMainStatValue = Math.max(0, (Number(stats.weaponMainStatValue) || 0) + after - before);
  }
  return next;
}
function monsterStats(stats, state, at) {
  if (!(Number(state.normalLive?.hutaoBossRiichi?.enragedUntil) > at)) return { ...stats };
  return { ...stats, critRate: Math.min(95, (Number(stats.critRate) || 0) + 50) };
}
function applyTicks(room, state, at) {
  for (const actor of room.members.values()) {
    const saved = state.normalLive.actors[actor.actorId];
    actor.riichi = { ...(saved?.riichi || actor.riichi) };
    const stats = playerStats(cardRules.timedStats(actor.stats, saved?.riichi, at), saved, at);
    const tick = calculateBattleTickMs(stats.agi);
    // Preserve progress toward the next swing when slow/buff starts or expires.
    if (actor.tick !== tick && actor.attackAt > at) actor.attackAt = at + (actor.attackAt - at) * tick / actor.tick;
    actor.tick = tick;
  }
}
function resultText(outcome) {
  return outcome === "tsumo" ? "🀄 胡桃立直・一發自摸！全體AGI−30，持續15秒。"
    : outcome === "strike" ? "🀄 胡桃立直・全體重擊！"
      : "🀄 胡桃立直・放槍！胡桃暴擊率＋50個百分點，持續15秒。";
}
module.exports = { INTERVAL_MS, EFFECT_MS, STRIKE_MULTIPLIER, initialize, claim, playerStats, monsterStats, applyTicks, resultText };
