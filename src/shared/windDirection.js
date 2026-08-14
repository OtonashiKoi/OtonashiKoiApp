"use strict";

const EFFECT_KEY = "wind_direction_cycle";
const DIRECTIONS = Object.freeze([
  Object.freeze({ key: "east", label: "東風", emoji: "🀀" }),
  Object.freeze({ key: "south", label: "南風", emoji: "🀁" }),
  Object.freeze({ key: "west", label: "西風", emoji: "🀂" }),
  Object.freeze({ key: "north", label: "北風", emoji: "🀃" }),
]);

const DEFAULT_CONFIG = Object.freeze({
  eastHit: 10,
  southFinalDamagePct: 8,
  westCritDamagePct: 20,
  northCritRatePct: 15,
});

function normalizeStep(value) {
  const n = Math.floor(Number(value) || 0);
  return ((n % DIRECTIONS.length) + DIRECTIONS.length) % DIRECTIONS.length;
}

function read(progress) {
  return normalizeStep(progress?.windDirectionStep);
}

function next(step) {
  return normalizeStep(normalizeStep(step) + 1);
}

function phaseAt(startStep, roundOffset = 0) {
  return DIRECTIONS[normalizeStep(normalizeStep(startStep) + Math.max(0, Math.floor(Number(roundOffset) || 0)))];
}

function normalizeConfig(effectOrParams = {}) {
  const p = effectOrParams?.params || effectOrParams || {};
  return {
    eastHit: Math.max(0, Number(p.eastHit) || DEFAULT_CONFIG.eastHit),
    southFinalDamagePct: Math.max(0, Number(p.southFinalDamagePct) || DEFAULT_CONFIG.southFinalDamagePct),
    westCritDamagePct: Math.max(0, Number(p.westCritDamagePct) || DEFAULT_CONFIG.westCritDamagePct),
    northCritRatePct: Math.max(0, Number(p.northCritRatePct) || DEFAULT_CONFIG.northCritRatePct),
  };
}

function hasEffect(equipped = {}) {
  return Object.values(equipped || {}).some((item) =>
    Array.isArray(item?.passiveEffects)
      && item.passiveEffects.some((effect) => effect?.key === EFFECT_KEY)
  );
}

module.exports = {
  EFFECT_KEY,
  DIRECTIONS,
  DEFAULT_CONFIG,
  normalizeStep,
  read,
  next,
  phaseAt,
  normalizeConfig,
  hasEffect,
};
