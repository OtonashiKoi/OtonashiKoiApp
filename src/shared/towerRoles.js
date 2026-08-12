"use strict";

const TOWER_ROLES = Object.freeze({
  tank: Object.freeze({ key: "tank", label: "坦", emoji: "🛡️", hpMultiplier: 1.3, atkMultiplier: 0.7, auraMultiplier: 0.5, targetPriority: 1 }),
  support: Object.freeze({ key: "support", label: "補", emoji: "💚", hpMultiplier: 0.7, atkMultiplier: 0.7, auraMultiplier: 1.3, targetPriority: 2 }),
  dps: Object.freeze({ key: "dps", label: "輸出", emoji: "⚔️", hpMultiplier: 1, atkMultiplier: 1.2, auraMultiplier: 0.5, targetPriority: 3 })
});

const ROLE_ALIASES = new Map([
  ["tank", "tank"], ["坦", "tank"],
  ["support", "support"], ["heal", "support"], ["healer", "support"], ["補", "support"], ["輔助", "support"],
  ["dps", "dps"], ["damage", "dps"], ["輸出", "dps"]
]);

function normalizeTowerRole(value) {
  return ROLE_ALIASES.get(String(value || "").trim().toLowerCase()) || null;
}

function getTowerRole(value) {
  const key = normalizeTowerRole(value);
  return key ? TOWER_ROLES[key] : null;
}

function scaleTowerAuraEffect(effect, roleValue) {
  const role = getTowerRole(roleValue);
  if (!effect || !role) return effect;
  const params = { ...(effect.params || {}) };
  const value = Number(params.value);
  if (Number.isFinite(value)) params.value = value * role.auraMultiplier;
  return { ...effect, params, towerRole: role.key, roleAuraMultiplier: role.auraMultiplier };
}

function scaleTowerRoleHp(value, roleValue) {
  return Number(value || 0) * (getTowerRole(roleValue)?.hpMultiplier || 1);
}

function scaleTowerRoleAtk(value, roleValue) {
  return Number(value || 0) * (getTowerRole(roleValue)?.atkMultiplier || 1);
}

function selectTowerMonsterTarget(members = []) {
  const alive = members.filter((member) => member && Number(member.currentHp) > 0);
  if (alive.length === 0) return null;
  return alive
    .map((member, index) => ({ member, index, role: getTowerRole(member.towerRole) || TOWER_ROLES.dps }))
    .sort((a, b) => (a.role.targetPriority - b.role.targetPriority) || (a.index - b.index))[0].member;
}

module.exports = {
  TOWER_ROLES,
  normalizeTowerRole,
  getTowerRole,
  scaleTowerRoleHp,
  scaleTowerRoleAtk,
  scaleTowerAuraEffect,
  selectTowerMonsterTarget
};
