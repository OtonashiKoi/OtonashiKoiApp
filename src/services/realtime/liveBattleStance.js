"use strict";
const { resolveRequestedStance } = require("../../shared/battleStance");
const fail = (message, status = 409) => Object.assign(new Error(message), { status, statusCode: status });
async function setStance(engine, actorId, battleId, requested) {
  const actor = engine.players.get(actorId);
  if (!actor || actor.joining || actor.id !== battleId) throw fail("這場戰鬥已結束或已換場");
  return engine.serial(actor.initial.zone, async () => {
    const a = engine.players.get(actorId), room = engine.zones.get(actor.initial.zone);
    if (!a || a.id !== battleId || a.done || !room || room.closed) throw fail("這場戰鬥已結束或已換場");
    const stance = resolveRequestedStance(a.options.equipped, requested);
    if (!stance) throw fail("目前職業沒有可切換的招式", 400);
    for (let attempt = 0; attempt < 6; attempt++) {
      let state = await room.sc.monsterService.getState(room.zone);
      if (state.pendingLivePotion) state = await require("./liveBattlePotions").recover(room, engine, state);
      const saved = state.normalLive?.actors?.[actorId];
      if (Number(state.activeMonsterSeq) !== room.seq || state.activeTransition || state.activeEvent || Number(state.currentHp) <= 0
        || saved?.id !== battleId || !saved.active || Number(saved.hp) <= 0 || a.hp <= 0) throw fail("倒地或戰鬥結束後不能切換招式");
      const progress = await room.sc.progressRepository.findByPlayerId(actorId);
      if (saved.seasonKey !== progress?.seasonKey || Number(saved.slot || 1) !== Number(progress?.activeCharacterSlot || 1)) throw fail("人物或賽季已變更");
      const candidate = structuredClone(state);
      Object.assign(candidate.normalLive.actors[actorId], { stance, stanceChangedAt: engine.now() });
      if (!await room.sc.monsterService.saveStateIfActiveMonster(candidate, room.zone, room.seq, state.currentHp)) continue;
      a.options.stance = stance;
      // Selection does not restart the core, reset cooldowns or advance attack time.
      return { liveBattleId: battleId, stance, nextAttackAt: a.attackAt };
    }
    throw fail("招式切換尚未存檔，請重試", 503);
  });
}
module.exports = { setStance };
