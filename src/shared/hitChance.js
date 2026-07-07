function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 命中率 = 62 + 命中×0.5 − 迴避×0.6（夾 20~95）
// V0.4 平衡：常數 75→62，讓「命中/迴避」成為中後期真屬性（配合各區迴避帶與玩家命中基礎 50+DEX）。
// 怪物命中基礎值同步 80→85 補償，使此調整「只作用在玩家攻擊側」，怪打玩家的命中維持原水準。
function calcHitChance({ hit = 0, dodge = 0, min = 20, max = 95 } = {}) {
  const raw = 62 + toNumber(hit) * 0.5 - toNumber(dodge) * 0.6;
  return clamp(raw, min, max);
}

module.exports = {
  calcHitChance,
};
