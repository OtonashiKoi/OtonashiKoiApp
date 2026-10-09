"use strict";
const { DESCRIPTION } = require("../../src/shared/hutaoRiichiCard");
function skill() {
  return { key: "hutao_riichi", name: "立直・四風", trigger: "battle_event", chance: 50, cooldownTurns: 0,
    intervalMs: 20000, buffDurationMs: 15000, description: DESCRIPTION, procEffects: [],
    monsterSkill: { key: "hutao_four_winds", name: "東南西北", trigger: "on_hit", chance: 12, cooldownTurns: 0,
      description: "命中時12%機率追加四風連擊，每段45%自身攻擊力。",
      procEffects: [{ key: "proc_chain_hit", target: "enemy", chance: 100, params: { chainCount: 4, damageMultiplier: .45 } }] } };
}
function candidate(card, monster, config) {
  const nextCard = { ...card, description: DESCRIPTION, monsterCardSkill: skill() };
  const nextMonster = { ...monster, entryFee: 50000, equipment: { ...monster.equipment, special_1: { ...monster.equipment.special_1, description: DESCRIPTION, monsterCardSkill: skill() } } };
  const nextConfig = { ...config, value: { ...config.value, respawnCooldownMinutes: 30, phaseConfig: [] } };
  return { card: nextCard, monster: nextMonster, config: nextConfig };
}
module.exports = { candidate, skill };
