"use strict";

// A hit can add or refresh defenses after the round's attack stats were computed.
function cardDefensiveModifiers(effects = [], round = 1) {
  const result = { defPct: 0, defFlat: 0, defDown: 0, reduction: 0,
    physical: 0, magic: 0, dodge: 0, block: 0, invincible: false };
  for (const effect of effects) {
    if (!effect) continue;
    const p = effect.params || {};
    if (p.duration?.mode === "turns" && round > (effect.appliedAt || 1) + (p.duration.value || 1)) continue;
    const v = Math.abs(Number(p.value) || 0);
    switch (effect.key) {
      case "def_up": result[p.mode === "flat" ? "defFlat" : "defPct"] += v; break;
      case "def_down": result.defDown += v; break;
      case "damage_reduction": result.reduction += v; break;
      case "physical_damage_reduction": result.physical += v; break;
      case "magic_damage_reduction": result.magic += v; break;
      case "dodge_up": result.dodge += v; break;
      case "agi_up": result.dodge += v * .5; break;
      case "agi_down": result.dodge -= v * .5; break;
      case "block_chance_up": result.block += v; break;
      case "invincible_short": result.invincible = true; break;
    }
  }
  return result;
}

module.exports = { cardDefensiveModifiers };
