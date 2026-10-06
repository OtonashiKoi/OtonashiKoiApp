"use strict";
const { encounterKey } = require("./normalLiveJournal");
const { normalMaxHp, scaleNormalMonster } = require("../monster/normalCoopScaling");

function monsterTurn(room, at) {
  return Math.max(0, Math.floor((at - room.epoch) / room.enemyTick));
}

// Absolute monster turns survive an empty room and a new runtime. Player
// attacks and joining/leaving cannot advance or reset this clock.
function beginMonsterAction(room, state, at, enemy) {
  const turn = monsterTurn(room, at);
  const sameEncounter = state.normalLive?.encounterKey === encounterKey(room.zone, room.seq, state);
  const saved = sameEncounter ? state.normalLive.monster : null;
  const readyTurns = { ...(saved?.skillReadyTurns || {}) };
  const triggerCounts = { ...(saved?.skillTriggerCounts || {}) };
  if (sameEncounter && !saved) {
    // One-time compatibility with snapshots made before the shared clock.
    for (const actor of Object.values(state.normalLive.actors || {})) {
      const lastTurn = monsterTurn(room, Number(actor.lastAt) || at);
      for (const [key, remaining] of Object.entries(actor.result?.cardCooldowns?.monster || {})) {
        readyTurns[key] = Math.max(Number(readyTurns[key]) || 0, lastTurn + Math.max(0, Number(remaining) || 0));
      }
    }
  }
  const cooldowns = Object.fromEntries(Object.entries(readyTurns)
    .map(([key, ready]) => [key, Math.max(0, Number(ready) - turn)]));
  return { turn, enemy, readyTurns, cooldowns, triggerCounts, nextTriggerCounts: { ...triggerCounts }, healed: 0, damage: 0,
    startHp: scaleNormalMonster(state, room.monster, state.damageMap).currentHp };
}

// Every target sees the same pre-action cooldown. A single monster action may
// affect several targets, while its cooldown is started only once afterward.
function monsterCardOptions(clock, previous) {
  return {
    tickCardCooldowns: !clock.enemy,
    cardCooldowns: {
      player: { ...(previous?.cardCooldowns?.player || {}) },
      monster: { ...clock.cooldowns },
    },
    cardTriggerCounts: {
      player: { ...(previous?.cardTriggerCounts?.player || {}) },
      monster: { ...clock.triggerCounts },
    },
  };
}

function recordMonsterAction(clock, result, startHp) {
  if (!clock.enemy) return;
  clock.damage += Math.max(0, Math.round(Number(result.totalDamage) || 0));
  for (const [key, count] of Object.entries(result.cumulative?.cardTriggerCounts?.monster || {})) {
    clock.nextTriggerCounts[key] = Math.max(Number(clock.nextTriggerCounts[key]) || 0, Number(count) || 0);
  }
  for (const [key, remaining] of Object.entries(result.cumulative?.cardCooldowns?.monster || {})) {
    if (Number(remaining) > (Number(clock.cooldowns[key]) || 0)) {
      clock.readyTurns[key] = Math.max(Number(clock.readyTurns[key]) || 0, clock.turn + Number(remaining));
    }
  }
  // A self heal belongs to the monster, regardless of which target's action
  // produced it. Apply it once even when several recipients see the skill.
  clock.healed = Math.max(clock.healed, Math.max(0,
    result.finalMonsterHp - startHp + Math.max(0, Number(result.totalDamage) || 0)));
}

function saveMonsterClock(state, clock) {
  state.normalLive.monster = { turn: clock.turn, skillReadyTurns: { ...clock.readyTurns },
    skillTriggerCounts: { ...clock.nextTriggerCounts } };
}

function applyMonsterHp(state, room, clock) {
  if (clock.enemy) state.currentHp = Math.max(0, Math.min(normalMaxHp(state, room.monster),
    clock.startHp + clock.healed - clock.damage));
}

module.exports = { monsterTurn, beginMonsterAction, monsterCardOptions, recordMonsterAction, saveMonsterClock, applyMonsterHp };
