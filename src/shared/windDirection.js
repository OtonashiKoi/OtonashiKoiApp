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
  phaseRounds: 1,
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

function phaseAt(startStep, roundOffset = 0, phaseRounds = 1) {
  const rounds = Math.max(1, Math.floor(Number(phaseRounds) || 1));
  const phaseOffset = Math.floor(Math.max(0, Math.floor(Number(roundOffset) || 0)) / rounds);
  return DIRECTIONS[normalizeStep(normalizeStep(startStep) + phaseOffset)];
}

function normalizeConfig(effectOrParams = {}) {
  const p = effectOrParams?.params || effectOrParams || {};
  return {
    eastHit: Math.max(0, Number(p.eastHit) || DEFAULT_CONFIG.eastHit),
    southFinalDamagePct: Math.max(0, Number(p.southFinalDamagePct) || DEFAULT_CONFIG.southFinalDamagePct),
    westCritDamagePct: Math.max(0, Number(p.westCritDamagePct) || DEFAULT_CONFIG.westCritDamagePct),
    northCritRatePct: Math.max(0, Number(p.northCritRatePct) || DEFAULT_CONFIG.northCritRatePct),
    phaseRounds: Math.max(1, Math.floor(Number(p.phaseRounds) || DEFAULT_CONFIG.phaseRounds)),
  };
}

function hasEffect(equipped = {}) {
  const hasBattleLocalSetCycle = (() => {
    try {
      const { getSetEffects } = require("./equipmentSetBonuses");
      return getSetEffects(equipped).some((effect) =>
        effect?.key === EFFECT_KEY && normalizeConfig(effect).phaseRounds > 1
      );
    } catch (_) {
      return false;
    }
  })();
  // 大四喜完整套裝改成每場由東風起手的 3 回合場風，不沿用武器的跨場步進。
  if (hasBattleLocalSetCycle) return false;
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
