"use strict";

const TURTLE_TIDE_EFFECT_KEY = "turtle_tide_cycle";

const DEFAULT_TURTLE_TIDE = Object.freeze({
  phaseRounds: 2,
  highTideDamageReductionPct: 8,
  ebbFinalDamagePct: 8,
});

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeTurtleTideConfig(effectOrParams = {}) {
  const params = effectOrParams?.params || effectOrParams || {};
  return {
    phaseRounds: Math.max(1, Math.floor(positiveNumber(params.phaseRounds, DEFAULT_TURTLE_TIDE.phaseRounds))),
    highTideDamageReductionPct: positiveNumber(
      params.highTideDamageReductionPct,
      DEFAULT_TURTLE_TIDE.highTideDamageReductionPct
    ),
    ebbFinalDamagePct: positiveNumber(params.ebbFinalDamagePct, DEFAULT_TURTLE_TIDE.ebbFinalDamagePct),
  };
}

function turtleTidePhase(round, config = DEFAULT_TURTLE_TIDE) {
  const cfg = normalizeTurtleTideConfig(config);
  const safeRound = Math.max(1, Math.floor(Number(round) || 1));
  const phaseIndex = Math.floor((safeRound - 1) / cfg.phaseRounds);
  return phaseIndex % 2 === 0 ? "high_tide" : "ebb_tide";
}

function isTurtleTideTransitionRound(round, config = DEFAULT_TURTLE_TIDE) {
  const cfg = normalizeTurtleTideConfig(config);
  const safeRound = Math.max(1, Math.floor(Number(round) || 1));
  return (safeRound - 1) % cfg.phaseRounds === 0;
}

function findTurtleTideConfig(effects = []) {
  const effect = (Array.isArray(effects) ? effects : []).find((entry) => entry?.key === TURTLE_TIDE_EFFECT_KEY);
  return effect ? normalizeTurtleTideConfig(effect) : null;
}

module.exports = {
  TURTLE_TIDE_EFFECT_KEY,
  DEFAULT_TURTLE_TIDE,
  normalizeTurtleTideConfig,
  turtleTidePhase,
  isTurtleTideTransitionRound,
  findTurtleTideConfig,
};
