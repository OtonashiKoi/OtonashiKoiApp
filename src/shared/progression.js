"use strict";
const MAX_LEVEL = 50;
// 2026-10-05: approved proposal scaled uniformly by 1.5423183302743138.
// Total to Lv50: 41,425,282 EXP. Recalibration anchor: 27,814,323 total EXP
// maps to Lv45 + 1,426,646 / 2,853,289 EXP (about 50%).
// 43.7 hours assumes solo, no buffs, 20 seconds per monster and on-band maps;
// it is an estimate, not a measured combat or complete player-journey result.
const EXP_REQUIREMENTS = Object.freeze([1388, 1851, 2313, 3085, 3856, 4627, 5398, 6169, 6940, 37016, 41643, 46270, 50897, 55523, 60150, 64777, 69404, 74031, 78658, 305379, 315558, 325738, 335917, 346096, 356276, 366455, 376634, 386813, 396993, 795836, 822364, 848892, 875420, 901948, 928476, 955004, 981531, 1008059, 1034587, 2467709, 2544825, 2621941, 2699057, 2776173, 2853289, 2930405, 3007521, 3084637, 3161753]);
function expToNextLevel(level) {
  const value = Number(level);
  const normalized = Number.isFinite(value) ? Math.floor(value) : 1;
  if (normalized >= MAX_LEVEL) return 0;
  return EXP_REQUIREMENTS[Math.max(1, normalized) - 1];
}
module.exports = { MAX_LEVEL, EXP_REQUIREMENTS, expToNextLevel };
