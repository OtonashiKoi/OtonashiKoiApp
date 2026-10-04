"use strict";
const MAX_LEVEL = 50;
// Current ordinary-combat solo +3 median of sword/mage/archer: 45 active hours.
// Stages 1→10 / 10→20 / 20→30 / 30→40 / 40→50: 1 / 4 / 8 / 12 / 20 h.
// Calibration seed 20260930; held-out acceptance seed 937451. No acquisition time,
// skills, cards, pets, aura, bestiary or external buffs in this reference.
// Equipment stats are cloned per loadout; do not enhance the shared item library.
const EXP_REQUIREMENTS = Object.freeze([1092, 2219, 3361, 4512, 5670, 6834, 8003, 9173, 10348, 32040, 33643, 46470, 62557, 82365, 106417, 135228, 169363, 209404, 255953, 282463, 338552, 402383, 474587, 555828, 646792, 748178, 860712, 985140, 1122232, 1122232, 1206497, 1357435, 1521726, 1700094, 1893274, 1987940, 2194369, 2415857, 2653068, 4294183, 4694058, 5120171, 5573570, 6055277, 6566383, 7107957, 7681089, 8286904, 8926504]);
function expToNextLevel(level) {
  const value = Number(level);
  const normalized = Number.isFinite(value) ? Math.floor(value) : 1;
  if (normalized >= MAX_LEVEL) return 0;
  return EXP_REQUIREMENTS[Math.max(1, normalized) - 1];
}
module.exports = { MAX_LEVEL, EXP_REQUIREMENTS, expToNextLevel };
