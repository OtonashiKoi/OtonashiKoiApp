"use strict";
const stunRules = require('../../shared/dwarfStunGauge');
const freezeRules = require('../../shared/zoneFreezeGauge');
const ZONE = 'event_boss_hutao_preview';
const WINDOW_MS = 20000, IMMUNE_MS = 120000;
function ensure(state, at, seed = {}) {
  if (state.liveControlGauges) return state.liveControlGauges;
  state.liveControlGauges = {};
  for (const key of ['stun', 'freeze']) {
    const old = seed[key] || {}, remaining = Number(old.stunnedRemainMs || old.frozenRemainMs) || 0;
    state.liveControlGauges[key] = { value: Number(old.gauge) || 0,
      activeUntil: remaining > 0 ? at + remaining : 0,
      immuneUntil: remaining > 0 ? at + remaining + IMMUNE_MS : Number(old.immuneRemainMs) > 0 ? at + Number(old.immuneRemainMs) : 0,
      contributors: old.contributors || {}, windowContributors: old.windowContributors || {} };
  }
  return state.liveControlGauges;
}
function active(state, at) {
  const gauges = state.liveControlGauges || {}, contributors = {};
  const keys = ['stun', 'freeze'].filter(key => Number(gauges[key]?.activeUntil) > at);
  for (const key of keys) for (const [id, row] of Object.entries(gauges[key].windowContributors || {})) {
    contributors[id] = { ...row, amount: (contributors[id]?.amount || 0) + (Number(row.amount) || 0) };
  }
  return { active: keys.length > 0, style: keys.includes('stun') ? 'stun' : 'freeze', contributors };
}
function add(state, actor, result, at) {
  const gauges = ensure(state, at), triggered = [];
  const job = actor.options.equipped?.job_eq;
  const amounts = { stun: stunRules.canKnock(job) ? Number(result.combatStats?.attackRounds) || 0 : 0,
    freeze: freezeRules.canKnock(job) ? Number(result.combatStats?.frostAttackRounds) || 0 : 0 };
  for (const key of ['stun', 'freeze']) {
    const gauge = gauges[key], count = Math.max(0, Math.floor(amounts[key]));
    if (!count || at < Number(gauge.immuneUntil || 0)) continue;
    if (gauge.immuneUntil) Object.assign(gauge, { value: 0, activeUntil: 0, immuneUntil: 0, contributors: {}, windowContributors: {} });
    gauge.value += count;
    const prior = gauge.contributors[actor.actorId];
    gauge.contributors[actor.actorId] = { displayName: actor.actorName, jobId: String(job.itemId || job.id),
      jobName: key === 'stun' ? '矮人戰士長' : '元素師', amount: (Number(prior?.amount) || 0) + count };
    const threshold = key === 'stun' ? stunRules.thresholdFor(ZONE) : freezeRules.thresholdFor(ZONE);
    if (gauge.value >= threshold) {
      Object.assign(gauge, { value: 0, activeUntil: at + WINDOW_MS, immuneUntil: at + WINDOW_MS + IMMUNE_MS,
        windowContributors: structuredClone(gauge.contributors), contributors: {} });
      triggered.push(key);
    }
  }
  return triggered;
}
function credit(state, actorId, damage, at) {
  const { contributors } = active(state, at), total = Object.values(contributors).reduce((n, row) => n + row.amount, 0);
  if (!total || damage <= 0) return;
  for (const [id, row] of Object.entries(contributors)) if (id !== actorId) {
    const prior = state.damageMap[id] || {};
    state.damageMap[id] = { ...prior, name: prior.name || row.displayName, assist: (Number(prior.assist) || 0) + damage * 0.1 * row.amount / total };
  }
}
module.exports = { ZONE, WINDOW_MS, IMMUNE_MS, ensure, active, add, credit };
