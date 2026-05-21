function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calcHitChance({ hit = 0, dodge = 0, min = 20, max = 95 } = {}) {
  const raw = 75 + toNumber(hit) * 0.5 - toNumber(dodge) * 0.6;
  return clamp(raw, min, max);
}

module.exports = {
  calcHitChance,
};
