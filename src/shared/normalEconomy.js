"use strict";
// Solo +3 standard hourly supply, calibrated with current ordinary monsters.
// Reference is a rate benchmark, not a guarantee of a player's actual income.
const ECONOMY_VERSION = "normal-economy-20261002-v1";
const IDLE_REWARD_RATIO = 0.1;
const MAX_LEVEL_EXP_TO_GOLD_DIVISOR = 200;
const NORMAL_ZONE_HOURLY_REWARDS = Object.freeze({
  "beginner": {
    "referenceLevel": 1,
    "goldPerHour": 12000,
    "expPerHour": 11816
  },
  "normal": {
    "referenceLevel": 5,
    "goldPerHour": 60000,
    "expPerHour": 74657
  },
  "mid": {
    "referenceLevel": 15,
    "goldPerHour": 120000,
    "expPerHour": 277601
  },
  "ancient_city": {
    "referenceLevel": 25,
    "goldPerHour": 180000,
    "expPerHour": 788856
  },
  "mistwood": {
    "referenceLevel": 35,
    "goldPerHour": 320000,
    "expPerHour": 1506821
  },
  "ancient_city_deep": {
    "referenceLevel": 45,
    "goldPerHour": 450000,
    "expPerHour": 3197491
  },
  "dragon_realm": {
    "referenceLevel": 45,
    "goldPerHour": 450000,
    "expPerHour": 3044550
  },
  "hellfire": {
    "referenceLevel": 45,
    "goldPerHour": 450000,
    "expPerHour": 2863835
  },
  "metal_mine": {
    "referenceLevel": 45,
    "goldPerHour": 450000,
    "expPerHour": 2762971
  }
});
module.exports = { ECONOMY_VERSION, IDLE_REWARD_RATIO, MAX_LEVEL_EXP_TO_GOLD_DIVISOR, NORMAL_ZONE_HOURLY_REWARDS };
