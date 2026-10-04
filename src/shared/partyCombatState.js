"use strict";
const jobs = require("./jobAdvancement");
const berserk = require("./berserkGauge");
const bard = require("./bardSong");
const { bestiaryRequirement, bestiaryBonusPct, MAX_BONUS_PCT } = require("./bestiary");

const resources = { shadowGauge: "shadowGaugeGrids", oniGauge: "oniGaugeGrids", sniperGauge: "sniperGaugeGrids",
  sageGauge: "sageGaugeGrids", diceGauge: "diceGaugeGrids", diceLuck: "diceLuckStacks" };

function beginFloor(member, monster) {
  member.floorSkillComboSpent = 0;
  member.floorAttackRounds = 0;
  const badge = member.equipped?.job_eq;
  const area = member.partyArea || "party:normal";
  const p = member.progressSnapshot;
  const state = member.partyJobState ||= {
    ...Object.fromEntries(Object.entries(resources).filter(([key]) => key !== "diceLuck").map(([key, value]) => [value, require(`./${key}`).read(p, area)])),
    diceLuckStacks: require("./diceGauge").readLuck(p), sunSpiritHpPct: require("./sunSpirit").read(p, area),
    berserkGauge: berserk.read(p, jobs.getGauge(badge)), zoneComboCount: require("./zoneCombo").readCombo(p, area) };
  if (state.sunSpiritHpPct <= 0) state.sunSpiritHpPct = require("./sunSpirit").RESUMMON_PCT;
  state.spiritOnEntry = state.sunSpiritHpPct > 0;
  const cfg = jobs.getGauge(badge);
  state.warGaugeFull = !!cfg && berserk.isFull(state.berserkGauge, cfg);
  member.activeEffects = structuredClone(member.progressSnapshot?.activeEffects || []).filter(e => !["berserk_gauge", "blood_sacrifice"].includes(e.sourceType));
  if (state.warGaugeFull) member.activeEffects.push(...berserk.buffs(cfg));
  if (member.strategy?.sacrifice && jobs.getSacrifice(badge)) member.activeEffects.push(...berserk.sacrificeBuffs(jobs.getSacrifice(badge)));
  const sage = jobs.getSage(badge);
  const mult = sage ? Number(sage.knowledgeMult) || 2 : 1;
  state.bestiaryBonusPct = bestiaryBonusPct(Number(member.progressSnapshot?.bestiary?.[String(monster.id || monster._id || monster.name)]) || 0,
    bestiaryRequirement(monster, false)) * mult;
  state.bestiaryBonusCapPct = MAX_BONUS_PCT * mult;
}

function syncLiveStrategy(member) {
  member.activeEffects = (member.activeEffects || []).filter(e => e.sourceType !== "blood_sacrifice");
  const cfg = jobs.getSacrifice(member.equipped?.job_eq);
  if (member.strategy?.sacrifice && cfg) member.activeEffects.push(...berserk.sacrificeBuffs(cfg));
}

function battleOptions(member) {
  const state = member.partyJobState || {};
  const badge = member.equipped?.job_eq;
  const sacrifice = jobs.getSacrifice(badge);
  return { ...Object.fromEntries(Object.values(resources).map(k => [k, Number(state[k]) || 0])),
    sunSpiritHpPct: state.sunSpiritHpPct ?? 100, zoneComboCount: state.zoneComboCount || 0,
    stance: require("./battleStance").resolveRequestedStance(member.equipped, member.strategy?.stance),
    sacrificeHpCostPct: member.strategy?.sacrifice ? Number(sacrifice?.hpCostPct) || 0 : 0,
    sacrificeAtkUpPct: member.strategy?.sacrifice ? Number(sacrifice?.atkUpPct) || 0 : 0,
    warGaugeCritBonus: state.warGaugeFull ? Number(jobs.getGauge(badge)?.critRateBonus) || 0 : 0,
    bardDamageMult: member.strategy?.bardResult?.dmgMult || 1,
    bardChordPct: member.strategy?.bardResult?.chordPct || 0,
    bardPerformanceId: member.strategy?.bardPerformanceId,
    sacrificeActivationId: member.strategy?.sacrifice ? member.strategy?.sacrificeActivationId : null,
    bardPerformNote: member.strategy?.bardResult?.note,
    teamStunRounds: member.partyEnvironment?.freezeOn ? 999999 : 0,
    teamStunStyle: member.partyEnvironment?.freezeOn ? "freeze" : undefined,
    sanctuaryCutPct: member.partyEnvironment?.sanctumOn ? Number(jobs.getSanctum({ itemId: "job_sanctum_t2_v1" })?.sanctumDamageCutPct) || 50 : 0,
    sanctuaryHealPct: member.partyEnvironment?.sanctumOn ? Number(jobs.getSanctum({ itemId: "job_sanctum_t2_v1" })?.sanctumHealPct) || 3 : 0,
    bestiaryBonusPct: state.bestiaryBonusPct || 0, bestiaryBonusCapPct: state.bestiaryBonusCapPct,
  };
}

function recordAction(member, result) {
  const state = member.partyJobState ||= {};
  member.floorSkillComboSpent = (member.floorSkillComboSpent || 0) + (Number(result.jobSkillComboSpent) || 0);
  member.floorAttackRounds = (member.floorAttackRounds || 0) + (Number(result.combatStats?.attackRounds) || 0);
  for (const [from, to] of Object.entries(resources)) if (result[from] != null) state[to] = result[from];
  if (result.sunSpirit) state.sunSpiritHpPct = result.sunSpirit.hpPct;
  member.partyJobView = { shadowGauge: result.shadowGauge, oniGauge: result.oniGauge,
    sniperGauge: result.sniperGauge, sageGauge: result.sageGauge, diceGauge: result.diceGauge, diceLuck: result.diceLuck,
    sunSpirit: result.sunSpirit, sanctum: result.sanctum };
}

function endFloor(member, survived) {
  const state = member.partyJobState;
  if (!state) return;
  const cfg = jobs.getGauge(member.equipped?.job_eq);
  if (cfg) state.berserkGauge = berserk.next(state.berserkGauge, cfg, { consumed: state.warGaugeFull }).count;
  state.zoneComboCount = require("./zoneCombo").nextCombo(state.zoneComboCount, member.partyArea || "party:normal",
    member.currentHp > 0 ? "win" : "lose", Date.now(), { spend: member.floorSkillComboSpent || 0,
      hasDeathGuard: !!require("./oniGauge").hasGauge(member.equipped?.job_eq) }).count;
  if (member.currentHp <= 0) {
    for (const key of ["shadowGaugeGrids", "oniGaugeGrids", "sniperGaugeGrids", "sageGaugeGrids", "diceGaugeGrids"]) state[key] = 0;
    member.bardStreak = 0;
    member.bardLevel = 0;
    if (member.strategy) member.strategy.bardResult = null;
  }
}

function persistedState(member, now = Date.now()) {
  const state = member.partyJobState;
  if (!state) return {};
  const badge = member.equipped?.job_eq, area = member.partyArea || "party:normal", result = {};
  for (const [field, option] of Object.entries(resources)) {
    if (field === "diceLuck") continue;
    const module = require(`./${field}`);
    if (module.hasGauge(badge)) result[field] = module.next(state[option], area, now);
  }
  if (require("./diceGauge").hasGauge(badge)) result.diceLuck = require("./diceGauge").nextLuck(state.diceLuckStacks, now);
  if (jobs.getGauge(badge)) result.berserkGauge = { count: state.berserkGauge, updatedAt: now };
  if (jobs.getSunSpirit(badge)) result.sunSpirit = require("./sunSpirit").next(state.sunSpiritHpPct, area, now);
  if (bard.hasSong(badge)) result.bardStreak = bard.nextStreak(member.bardStreak, area, member.bardLevel, now);
  if (require("./oniGauge").hasGauge(badge)) result.zoneCombo = { zone: area, count: state.zoneComboCount, updatedAt: now, diedOnce: false };
  return result;
}

function auraMultiplier(member) {
  let mult = 1;
  if (jobs.getSunSpirit(member.equipped?.job_eq) && member.partyJobState?.spiritOnEntry !== false) mult *= 2;
  if (bard.hasSong(member.equipped?.job_eq)) mult *= bard.auraMult(member.bardStreak || 0);
  if (jobs.getSanctum(member.equipped?.job_eq) && member.partyEnvironment?.sanctumOn) mult *= 2;
  return mult;
}

// Shared enemy effects use the enemy's action clock. Project into the core's
// owner round only while resolving one action, then restore the shared clock.
function projectEffects(effects, from, to) {
  return structuredClone(effects || []).map(e => ({ ...e, _clockExact: true,
    appliedAt: Number(e.appliedAt ?? 1) + to - from + (e.sourceType === "monster_skill" && !e._clockExact ? 1 : 0) }));
}

function zoneEnvironment(room, zone, now) {
  const value = room.zoneEnvironments ||= {};
  const state = value[zone] ||= { freeze: { gauge: 0 }, sanctum: { gauge: 0 } };
  return { freezeOn: now < (state.freeze.until || 0), sanctumOn: now < (state.sanctum.until || 0), state };
}
function knockEnvironment(room, zone, now) {
  const env = zoneEnvironment(room, zone, now);
  for (const kind of ["freeze", "sanctum"]) {
    const module = require(kind === "freeze" ? "./zoneFreezeGauge" : "./sanctumGauge");
    const window = env.state[kind];
    if (now < (window.immuneUntil || 0)) continue;
    const amount = room.members.reduce((sum, m) => sum + (module.canKnock(m.equipped?.job_eq)
      && (kind !== "freeze" || m.strategy?.stance === "frost") ? kind === "freeze" ? m.floorAttackRounds || 0 : 1 : 0), 0);
    window.gauge += amount;
    if (window.gauge >= module.thresholdFor(zone)) {
      window.gauge = 0;
      window.until = now + (kind === "freeze" ? module.FREEZE_WINDOW_MS : module.SANCTUM_WINDOW_MS);
      window.immuneUntil = window.until + module.IMMUNE_MS;
    }
  }
}
module.exports = { syncLiveStrategy, beginFloor, battleOptions, recordAction, endFloor, auraMultiplier, projectEffects, zoneEnvironment, knockEnvironment, persistedState };
