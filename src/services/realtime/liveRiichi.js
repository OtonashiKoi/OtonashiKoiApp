"use strict";
const rules = require("../../shared/hutaoRiichiCard");
const { calculateBattleTickMs } = require("../../shared/battleTiming");
function due(a, at) { return rules.hasCard(a.options.equipped) && Number(a.riichi?.nextAt || 0) <= at; }
function prepare(room, state, at) {
  const pulses = new Map();
  state.normalLive.riichiUpdates ||= {};
  for (const a of room.members.values()) {
    if (a.done || a.hp <= 0 || !due(a, at)) continue;
    const self = state.normalLive.actors[a.actorId];
    if (Number(self.riichi?.nextAt || 0) > at) continue;
    const tsumo = Math.random() < .5;
    self.riichi = { ...(self.riichi || {}), nextAt: at + rules.INTERVAL_MS };
    for (const target of room.members.values()) {
      if (target.done) continue;
      const saved = state.normalLive.actors[target.actorId];
      saved.riichi ||= {};
      const key = tsumo ? "agiUntil" : "lukUntil";
      saved.riichi[key] = Math.max(Number(saved.riichi[key]) || 0, at + rules.BUFF_MS);
      state.normalLive.riichiUpdates[target.actorId] = { ...saved.riichi, updatedAt: at, slot: saved.slot, seasonKey: saved.seasonKey };
    }
    state.normalLive.riichiUpdates[a.actorId] = { ...self.riichi, updatedAt: at, slot: self.slot, seasonKey: self.seasonKey };
    if (!tsumo) self.hp = Math.max(1, self.hp - Math.floor(self.hp * .1));
    pulses.set(a.actorId, { tsumo, at });
  }
  return pulses;
}
async function flush(sc, state) {
  for (const [id, update] of Object.entries(state.normalLive?.riichiUpdates || {})) {
    const { withPlayerProgressLock } = require("../progress/progressLocks");
    await withPlayerProgressLock(id, async () => {
      const p = await sc.progressRepository.findByPlayerId(id);
      if (!p || (update.slot && (Number(p.activeCharacterSlot || 1) !== update.slot || p.seasonKey !== update.seasonKey)) || Number(p.hutaoRiichi?.updatedAt || 0) >= update.updatedAt) return;
      await sc.progressRepository.updateFields(id, { hutaoRiichi: update });
    });
  }
}
function apply(room, state, at) {
  for (const a of room.members.values()) {
    const saved = state.normalLive.actors[a.actorId];
    a.riichi = { ...(saved?.riichi || a.riichi) };
    a.baseTick ||= a.tick;
    a.tick = Number(a.riichi.agiUntil) > at ? calculateBattleTickMs(rules.timedStats(a.stats, a.riichi, at).agi) : a.baseTick;
  }
}
module.exports = { due, prepare, flush, apply };
