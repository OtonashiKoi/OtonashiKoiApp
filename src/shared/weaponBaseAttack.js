"use strict";

// Main-stat allocation still uses its diminishing curve. The weapon's own
// attack remains separate so a higher-grade weapon is not diluted by armor,
// level-up attributes, pets or buffs. Weapon-type ratios remain unchanged.
const WEAPON_BASE_ATTACK = Object.freeze({ D: 0, C: 20, B: 55, A: 110, S: 180 });
function weaponBaseAttack(weapon, weaponMultiplier) {
  if (!weapon?.weaponType) return 0;
  const base = WEAPON_BASE_ATTACK[String(weapon.tier || '').toUpperCase()] || 0;
  return Math.round(base * Math.max(0, Number(weaponMultiplier) || 0) / 4);
}
module.exports = { WEAPON_BASE_ATTACK, weaponBaseAttack };
