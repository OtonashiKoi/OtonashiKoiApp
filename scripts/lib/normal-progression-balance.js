"use strict";

// Migration targets are spawn-weighted means, not per-monster identical stats.
// Keep individual HP/reward ratios, drops, skills and encounter identities.
const REVISION = "normal-progression-20260929-v1";
const TARGETS = {
  normal: { min: 4, max: 9, hp: 1500, exp: 450, str: 0.8 },
  mid: { min: 10, max: 19, hp: 3000, exp: 1600, str: 0.45 },
  ancient_city: { min: 20, max: 29, hp: 6000, exp: 5000, str: 0.45 },
  ancient_city_deep: { min: 30, max: 39, hp: 10000, exp: 11500, str: 0.55 },
  dragon_realm: { min: 40, max: 49, hp: 16000, exp: 26000, str: 0.25 },
  hellfire: { min: 40, max: 49, hp: 16000, exp: 26000, str: 0.25 },
};

function buildPlan(monsters) {
  const plan = [];
  for (const [zone, t] of Object.entries(TARGETS)) {
    const eligible = monsters.filter(m => m.zone === zone && m.enabled && !m.allZones
      && !m.incomingDamageCap && !String(m.name).includes("稀"));
    const normal = eligible.filter(m => !m.isBoss);
    if (!normal.length) continue;
    // A partially applied migration must be repaired from its saved plan, not rescaled.
    const applied = eligible.filter(m => m.progressionBalanceRevision === REVISION);
    if (applied.length === eligible.length) continue;
    if (applied.length) throw new Error(`Partial migration in ${zone}; resume from the backup plan`);
    const weight = m => Math.max(0, Number(m.spawnRate) || 0);
    const total = normal.reduce((s, m) => s + weight(m), 0);
    if (!total) throw new Error(`No spawn weight in ${zone}`);
    const mean = key => normal.reduce((s, m) => s + weight(m) * Number(m[key]), 0) / total;
    const min = Math.min(...normal.map(m => m.level));
    const max = Math.max(...normal.map(m => m.level));
    for (const m of eligible) {
      const hp = Math.max(1, Math.round(m.maxHp / mean("maxHp") * t.hp));
      const values = {
        level: m.isBoss ? Math.min(50, t.max + 1)
          : Math.round(t.min + (m.level - min) / Math.max(1, max - min) * (t.max - t.min)),
        maxHp: hp,
        expReward: m.isBoss ? Math.round(hp * t.exp / t.hp * 1.3)
          : Math.max(1, Math.round(m.expReward / mean("expReward") * t.exp)),
        str: Math.max(1, Math.round(m.str * t.str)),
        def: zone === "normal" ? Math.min(75, m.def || 0)
          : Math.min(m.isBoss ? 65 : 55, Math.round((m.def || 0) * 0.55)),
        progressionBalanceRevision: REVISION,
      };
      if (Object.values(values).some(v => typeof v === "number" && !Number.isFinite(v))) {
        throw new Error(`Invalid monster data: ${m.name}`);
      }
      plan.push({ id: m.id, name: m.name, zone, before: Object.fromEntries(Object.keys(values).map(k => [k, m[k]])), values });
    }
  }
  return plan;
}

module.exports = { REVISION, TARGETS, buildPlan };
