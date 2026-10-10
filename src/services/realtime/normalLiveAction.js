"use strict";
const { runCombatLoop } = require("../../shared/combatLoop");
const { normalMaxHp } = require("../monster/normalCoopScaling");
const { encounterCount } = require("../../shared/encounterGroup");
const riichiRules = require("../../shared/hutaoRiichiCard");
const hutaoRules = require("../../shared/hutaoEvent");
const { monsterCardOptions } = require("./monsterActionClock");
const { companionEffects } = require("./starterCompanions");
const controls = require("./liveControlGauges");
const bossRiichi = require("./hutaoBossRiichi");
const hutaoEntry = require("./hutaoLiveEntry");

function partyEffects(room, recipient, state) {
  const humans=[...room.members.values()].filter(provider => {
    const hp = state?.normalLive?.actors?.[provider.actorId]?.hp ?? provider.hp;
    return !provider.done && provider.hp > 0 && Number(hp) > 0;
  }).flatMap(provider => (provider.options.partyEffects || [])
    .filter(effect => effect && String(effect.sourceDiscordId || "") === provider.actorId)
    .map(effect => ({ ...effect, isSelfAura: provider.actorId === recipient.actorId })));
  return humans.concat(companionEffects(room,state).filter(n=>!humans.some(h=>h.key===n.key&&Number(h.params?.value??h.value)>0)));
}

function action(engine, room, a, state, enemy, clock) {
  const now=engine.now();
  const command={...a.options,partyEffects:engine.partyEffects(room,a,state),actionSession:a.session,partyActorId:a.actorId,liveNormalCombat:true,startPlayerHp:a.hp,startMonsterHp:state.currentHp,encounterUnitHp:normalMaxHp(state,room.monster)/encounterCount(state,room.monster),skipPlayerAttack:enemy,skipMonsterAttack:!enemy,monsterActionRound:(a.enemyTurns||0)+1,tickJobSkillCooldowns:!enemy,monsterActiveEffects:a.result?.monsterActiveEffects||[],stunRoundsLeft:a.result?.stunRoundsLeft||0,monsterStunImmuneUntil:a.result?.monsterStunImmuneUntil||0,monsterKnockbackPending:a.result?.monsterKnockbackPending,sageMistPending:a.result?.sageMistPending,forceMonsterCritFailPending:a.result?.forceMonsterCritFailPending,...monsterCardOptions(clock,a.result)};
  command.allowCoopRevive = room.zone === hutaoEntry.ZONE;
  command.hutaoBossStrike = room.zone === hutaoEntry.ZONE && enemy && clock.hutaoBossRiichi?.outcome === "strike";
  if (room.zone === controls.ZONE) {
    const control = controls.active(state, now);
    command.liveControlActive = control.active;
    command.teamStunStyle = control.style;
    command.teamControlContributors = control.contributors;
  }
  const saved = state.normalLive.actors[a.actorId];
  const pulse = room.riichiPulses?.get(a.actorId);
  let stats = riichiRules.timedStats(a.stats, saved?.riichi, now);
  if (room.zone === hutaoEntry.ZONE) stats = bossRiichi.playerStats(stats, saved, now);
  command.startPlayerHp = saved?.hp ?? a.hp;
  if (!enemy && pulse?.tsumo) command.hutaoRiichiPulse = true;
  command.riichiOnly = !enemy && a.attackAt > now;
  command.tickJobSkillCooldowns = !enemy && !command.riichiOnly;
  let monsterStats = a.monsterStats;
  if (room.zone === hutaoEntry.ZONE) {
    const wind = hutaoRules.windAt(now);
    const effect = room.hutaoEvent?.effect;
    monsterStats = { ...room.monster.calc, dodge: wind.bossDodgeZero ? 0 : Math.min(95, (room.monster.calc.dodge || 0) + (wind.bossDodgeBonus || 0)),
      finalDamageMultiplier: (room.monster.calc.finalDamageMultiplier || 1) * (wind.bossDamageMultiplier || 1) };
    if (effect?.hpCrush && now < Number(effect.resolvedAt) + Number(effect.recoveryMs || 0))
      monsterStats.finalDamageMultiplier *= .6;
    monsterStats = bossRiichi.monsterStats(monsterStats, state, now);
    command.eventPlayerCritDamageMultiplier = wind.playerCritDamageMultiplier || 1;
    command.eventPlayerHitBonus = (command.eventPlayerHitBonus || 0) + (Number(effect?.playerHitBonus) || 0);
    command.bossVulnMult = (command.bossVulnMult || 1) * (wind.playerFinalDamageMultiplier || 1) * (Number(effect?.playerFinalDamageMultiplier) || 1);
  }
  command.livePlayerStats = stats; command.liveMonsterStats = monsterStats;
  const result=runCombatLoop(stats,monsterStats,room.monster.name,normalMaxHp(state,room.monster),15,command);
  if (clock.hutaoBossRiichi) result.roundLogs.unshift(bossRiichi.resultText(clock.hutaoBossRiichi.outcome));
  if (pulse && !enemy) result.roundLogs.unshift(pulse.tsumo ? "🀄 立直・自摸！全體共鬥AGI+15，持續15秒。" : "🀄 立直未自摸：全體共鬥LUK+5，持續15秒；自身扣當前HP10%。");
  a.options.playerActiveEffects=command.playerActiveEffects;
  return result;
}

module.exports = { partyEffects, action };
