"use strict";
function roomAuras(room) {
  const core = require("../../bot/handlers/towerHandlers");
  const effects = core.buildTowerPartyEffects(room.members, { zone: room.monsterPreview?.zone || null });
  const names = require("../../shared/effectDisplayNames").EFFECT_NAME_ZH;
  const { formatEffectValueText } = require("../../shared/itemEffectLines");
  const percent = new Set(["party_damage_up", "party_boss_damage_up", "party_monster_def_down", "party_agi_up", "party_max_hp_up", "party_crit_rate_up", "party_damage_reduction", "party_crit_damage_reduction", "party_exp_gain_up", "party_gold_gain_up", "support_shot"]);
  const displayed = effects.map(effect => {
    const name = names[effect.key] || (effect.key === "support_shot" ? "支援射擊係數" : "隊伍增益");
    const params = percent.has(effect.key) ? { ...effect.params, mode: "pct" } : effect.params;
    const value = effect.key === "support_shot" ? `${Number(effect.params?.value || 0)}%` : formatEffectValueText(effect.key, params);
    return { ...effect, notes: `${name} ${value}` };
  });
  return { auras: core.summarizeTowerAuras(displayed) };
}
module.exports = { roomAuras };
