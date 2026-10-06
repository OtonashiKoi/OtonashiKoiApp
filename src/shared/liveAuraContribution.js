"use strict";
const { directDamageAssistPot, defenseOffenseAssistPot } = require("./supportContribution");

// Credit only this action's effective support while its provider is present.
// Cumulative rounding prevents small assists from being lost on every attack.
function creditLiveAuraAction(ledger, action) {
  const groups = new Map();
  const value = effect => Math.abs(Number(effect.params?.value ?? effect.value) || 0);
  for (const effect of action.effects || []) {
    if (!effect || effect.isSelfAura !== false || !effect.sourceDiscordId || !value(effect)) continue;
    const list = groups.get(effect.key) || [];
    list.push(effect); groups.set(effect.key, list);
  }
  const candidates = (...keys) => keys.flatMap(key => groups.get(key) || []);
  const max = key => Math.max(0, ...candidates(key).map(value));
  const distribute = (pot, effects) => {
    const sum = effects.reduce((n, e) => n + value(e), 0);
    if (!(pot > 0) || !(sum > 0)) return;
    for (const effect of effects) {
      const id = String(effect.sourceDiscordId), amount = pot * value(effect) / sum;
      ledger.bySource[id] = (ledger.bySource[id] || 0) + amount;
      if (effect.sourceJobId) {
        const jobs = ledger.bySourceJob[id] ||= {}, key = effect.sourceJobId;
        jobs[key] = { amount: (jobs[key]?.amount || 0) + amount, jobName: effect.sourceJobName || "" };
      }
    }
  };
  for (const key of ["party_damage_up", "party_crit_rate_up", "party_agi_up", "party_combo_up",
    ...(action.boss ? ["party_boss_damage_up"] : []),
    ...(action.elite && !action.boss ? ["party_elite_damage_up"] : []),
    ...(action.highHp ? ["party_high_hp_damage_up"] : []),
    ...(action.stunned ? ["party_stunned_damage_up"] : [])]) {
    distribute(directDamageAssistPot(action.damage, max(key)), candidates(key));
  }
  distribute(defenseOffenseAssistPot({ totalDamage: action.damage, monsterDefPct: action.monsterDefPct,
    selfBypassPct: action.selfBypassPct, partyDefDownPct: max("party_monster_def_down"),
    partyDefIgnorePct: max("party_def_ignore_up") }), candidates("party_monster_def_down", "party_def_ignore_up"));
  distribute(action.heal, candidates("party_heal", "heal_over_time"));
  distribute(action.prevented, candidates("party_damage_reduction", "party_crit_damage_reduction"));
  return ledger;
}

module.exports = { creditLiveAuraAction };
