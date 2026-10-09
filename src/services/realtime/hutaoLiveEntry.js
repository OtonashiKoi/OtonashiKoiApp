"use strict";
const { withPlayerProgressLock } = require("../progress/progressLocks");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const potions = require("./liveBattlePotions");
const ZONE = "event_boss_hutao_preview", FEE = 50000;
async function currency(sc, id, name, op, refund = false) {
  return sc.rewardService.grantCurrency({ discordId: id, displayName: name, currencyType: "gold", amount: refund ? FEE : -FEE,
    source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE, sourceRef: `hutao-entry:${op.id}:${refund ? "refund" : "debit"}`, operator: "hutao:live-entry" });
}
async function prepare(sc, id, name, battleId) {
  return withPlayerProgressLock(id, async () => {
    let p = await sc.progressRepository.findByPlayerId(id);
    if (p?.hutaoEntryPending) {
      const pending = p.hutaoEntryPending, state = await sc.monsterService.getState(ZONE);
      const admitted = state.normalLive?.actors?.[id]?.id === pending.id;
      if (!admitted) {
        try { await currency(sc, id, name, pending); await currency(sc, id, name, pending, true); }
        catch (error) { if (error.code !== "INSUFFICIENT_BALANCE") throw error; }
      }
      await sc.progressRepository.updateFields(id, { hutaoEntryPending: null, hutaoChallengeUntil: 0 });
      p = await sc.progressRepository.findByPlayerId(id);
    }
    const pouch = potions.validate(p?.combatPotionPlan || {}, p?.inventory || [], { allowShortage: true });
    const op = { id: battleId };
    await sc.progressRepository.updateFields(id, { hutaoEntryPending: op });
    try { await currency(sc, id, name, op); }
    catch (error) {
      if (error.code === "INSUFFICIENT_BALANCE") await sc.progressRepository.updateFields(id, { hutaoEntryPending: null });
      throw error;
    }
    return { op, pouch, riichi: p.hutaoRiichi || {}, slot: Number(p.activeCharacterSlot || 1), seasonKey: p.seasonKey };
  });
}
async function commit(sc, id, entry) {
  await sc.progressRepository.updateFields(id, { hutaoEntryPending: null, hutaoChallengeUntil: 0 });
}
async function abort(sc, id, name, entry) {
  if (!entry) return;
  await currency(sc, id, name, entry.op, true);
  await sc.progressRepository.updateFields(id, { hutaoEntryPending: null });
}
module.exports = { ZONE, FEE, prepare, commit, abort };
