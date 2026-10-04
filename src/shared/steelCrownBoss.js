"use strict";
// HP uses the single shared body pool; one action counts only when a counterattack occurs.
function phaseAt(hp, maxHp) {
  const pct = Math.max(0, Number(hp) || 0) / Math.max(1, Number(maxHp) || 1) * 100;
  return pct >= 70 ? 1 : pct >= 30 ? 2 : 3;
}
function attacks(phase, action) {
  if (phase === 1) return [{ factor: action % 3 === 0 ? 1.5 : 1, name: action % 3 === 0 ? "鋼槌重擊" : null }];
  if (phase === 2) return action % 3 === 0 ? [{ factor: .9, name: "浮游兵裝" }, { factor: .9, name: "浮游兵裝" }] : [{ factor: 1, name: null }];
  const hits = [{ factor: action % 2 === 0 ? 2.5 : 1.2, name: action % 2 === 0 ? "爐心過載" : null }];
  if (action % 3 === 0) hits.push({ factor: .9, name: "浮游兵裝" }, { factor: .9, name: "浮游兵裝" });
  return hits;
}
function splitAttacks(hits, attack, finalMultiplier, levelMultiplier, reference, maxSegments) {
  return hits.flatMap(hit => {
    const nominal = attack * hit.factor * finalMultiplier * levelMultiplier;
    const count = nominal > reference ? Math.min(maxSegments, Math.ceil(nominal / reference)) : 1;
    return Array.from({ length: count }, () => ({ ...hit, factor: hit.factor / count }));
  });
}
module.exports = { phaseAt, attacks, splitAttacks };
