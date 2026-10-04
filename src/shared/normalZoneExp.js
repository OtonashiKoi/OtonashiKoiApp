"use strict";

// General training maps only. Boss/event/party maps retain their own reward rules.
const NORMAL_LEVEL_BANDS = Object.freeze({
  beginner: [1, 3], normal: [1, 9], mid: [10, 19], ancient_city: [20, 29],
  mistwood: [30, 39], ancient_city_deep: [40, 49], dragon_realm: [40, 49], hellfire: [40, 49], metal_mine: [40, 49],
});

function normalZoneExpMultiplier(zone, level) {
  const band = NORMAL_LEVEL_BANDS[zone];
  const lv = Number(level);
  if (!band || !Number.isFinite(lv) || lv < 1) return 1;
  const distance = Math.max(0, band[0] - lv, lv - band[1]);
  return Math.max(0.1, 1 - distance * 0.05);
}

module.exports = { NORMAL_LEVEL_BANDS, normalZoneExpMultiplier };
