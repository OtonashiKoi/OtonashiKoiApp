'use strict';
const { calcPlayerStats } = require('../../src/shared/combatStats');
const { runCombatLoop } = require('../../src/shared/combatLoop');
const { mergeEquippedFromLibrary, collectEquipmentEffects } = require('../../src/shared/effectEngine');
const { scaleSupportPartyEffects } = require('../../src/shared/supportAuraScaling');
const timing = require('../../src/shared/battleTiming');
const ja = require('../../src/shared/jobAdvancement');
const bestiary = require('../../src/shared/bestiary');
const song = require('../../src/shared/bardSong');
const berserk = require('../../src/shared/berserkGauge');
const sanctum = require('../../src/shared/sanctumGauge');
const combo = require('../../src/shared/zoneCombo');
const gauges = Object.fromEntries(['shadowGauge','oniGauge','sunSpirit','sniperGauge','sageGauge','diceGauge'].map(k => [k,require('../../src/shared/'+k)]));
const { grantKillCurrencyAndExp } = require('../../src/services/battle/grantKillCurrencyAndExp');
const { grantKillDrops } = require('../../src/services/battle/grantKillDrops');
const { recordQuestBattleProgress } = require('../../src/services/battle/battleQuestProgress');
async function fight(r, monster, hp, zone) {
  const p = r.progress, eq = await mergeEquippedFromLibrary(p.equipment, r.itemRepository);
  const stats = calcPlayerStats(p.attributes, eq, p.activeEffects, p.inventory, { zone });
  const gaugeCfg = ja.getGauge(eq.job_eq), war = gaugeCfg ? berserk.read(p, gaugeCfg, r.now) : 0;
  const full = !!gaugeCfg && berserk.isFull(war, gaugeCfg);
  const sac = ja.getSacrifice(eq.job_eq);
  const sr = await sanctum.read(zone, zone, r.now);
  const opts = { playerLevel:p.level, equipped:eq, inventory:p.inventory, zone,
    zoneComboCount:combo.readCombo(p,zone,r.now),
    stance:ja.getDefaultStance(eq.job_eq),
    playerActiveEffects:full?berserk.buffs(gaugeCfg):[], warGaugeCritBonus:full?gaugeCfg.critRateBonus:0,
    sacrificeHpCostPct:sac?.hpCostPct||0, sacrificeAtkUpPct:sac?.atkUpPct||0,
    shadowGaugeGrids:gauges.shadowGauge.read(p,zone,r.now), oniGaugeGrids:gauges.oniGauge.read(p,zone,r.now),
    sniperGaugeGrids:gauges.sniperGauge.read(p,zone,r.now), sageGaugeGrids:gauges.sageGauge.read(p,zone,r.now),
    diceGaugeGrids:gauges.diceGauge.read(p,zone,r.now), diceLuckStacks:gauges.diceGauge.readLuck(p),
    sunSpiritHpPct:gauges.sunSpirit.hasSpirit(eq.job_eq)?gauges.sunSpirit.read(p,zone,r.now):undefined,
    monsterEquipped:monster.equipment||{}, monsterIsBoss:!!monster.isBoss,
    monsterElement:monster.element||null, monsterElementLevel:monster.element?(monster.elementLevel||1):0,
    sanctuaryCutPct:sr.sanctum?50:0, sanctuaryHealPct:sr.sanctum?3:0,
  };
  const ownCard = opts.monsterEquipped.special_1;
  if (!ownCard?.monsterCardSkill?.key) {
    const card = r.items.find(i=>i.equipSlot==='special' && i.name.includes(monster.name+'卡'));
    if (card) opts.monsterEquipped={special_1:card};
  }
  if (ownCard?.itemId && !ownCard?.monsterCardSkill?.key) {
    const card = await r.itemRepository.findById(ownCard.itemId); if(card) opts.monsterEquipped={special_1:card};
  }
  let songResult;
  if(song.hasSong(eq.job_eq)) {
    const challenge=p.bardScore;
    // A disclosed ordinary-player policy: 90% correct per key, actual token/score.
    const input=challenge?{token:challenge.token,inputs:challenge.seq.map(k=>Math.random()<.9?k:song.DIRS.filter(d=>d!==k)[Math.floor(Math.random()*3)])}:null;
    songResult=song.scorePerformance(challenge,input,song.readStreak(p,zone,r.now));
    opts.bardDamageMult=songResult.dmgMult;opts.bardChordPct=songResult.chordPct;
  }
  const rawAura=collectEquipmentEffects(eq,'passive',{equipped:eq,inventory:p.inventory}).filter(e=>e.target==='party');
  opts.partyEffects=scaleSupportPartyEffects(rawAura.map(e=>({...e,isSelfAura:true,sourcePlayerId:r.id})),{providerStats:stats,equipped:eq});
  const auraMult=(gauges.sunSpirit.hasSpirit(eq.job_eq)&&opts.sunSpiritHpPct>0?2:1)*(song.hasSong(eq.job_eq)?song.auraMult(song.readStreak(p,zone,r.now)):1)*(sanctum.canKnock(eq.job_eq)&&sr.sanctum?2:1);
  if(auraMult!==1) opts.partyEffects=opts.partyEffects.map(e=>({...e,params:{...e.params,value:(e.params?.value||0)*auraMult}}));
  const knowledge=ja.getSage(eq.job_eq)?.knowledgeMult||1;
  opts.bestiaryBonusPct=bestiary.bestiaryBonusPct(p.bestiary?.[monster.id]||0,bestiary.bestiaryRequirement(monster))*knowledge;
  opts.bestiaryBonusCapPct=bestiary.MAX_BONUS_PCT*knowledge;
  // Optional calibration fixtures come from actual acquired player state, never
  // pre-equipped actors. Capturing must not consume random numbers or mutate it.
  r.captureCombat?.({level:p.level,zone,stats:structuredClone(stats),monster:structuredClone(monster),hp,options:structuredClone(opts)});
  const result=runCombatLoop(structuredClone(stats),{...monster.calc},monster.name,hp,15,opts);
  const rounds=Math.min(15,Math.max(1,result.outcome==='continue'?result.nextRound-1:result.nextRound));
  const ms=timing.calculateWebBattleCooldownMs({roundCount:rounds,perRoundMs:timing.calculateBattleTickMs(stats.agi),lost:result.outcome==='lose'})+(result.finalMonsterHp<=0?500:0);
  // The production normal-battle route starts each bout at full player HP;
  // monster HP persists. Do not invent continuous HP or automatic potions.
  p.bestiary||={};p.bestiary[monster.id]=(p.bestiary[monster.id]||0)+bestiary.bestiaryGainFromDamage(result.totalDamage,monster.calc.maxHp);
  p.zoneCombo=combo.nextCombo(opts.zoneComboCount,zone,result.outcome,r.now,{hasDeathGuard:combo.benefitsFromCombo(eq.job_eq),diedOnce:combo.readDiedOnce(p,zone,r.now),spend:result.jobSkillComboSpent||0});
  for(const [k,out] of [['shadowGauge','shadowGauge'],['oniGauge','oniGauge'],['sniperGauge','sniperGauge'],['sageGauge','sageGauge'],['diceGauge','diceGauge']]) {
    if(gauges[k].hasGauge(eq.job_eq))p[k]=gauges[k].next(result[out]??0,zone,r.now);
  }
  if(gauges.diceGauge.hasGauge(eq.job_eq))p.diceLuck=gauges.diceGauge.nextLuck(result.diceLuck||0);
  if(gauges.sunSpirit.hasSpirit(eq.job_eq))p.sunSpirit=gauges.sunSpirit.next(result.sunSpirit?.hpPct??opts.sunSpiritHpPct,zone,r.now);
  if(gaugeCfg)p.berserkGauge=berserk.next(war,gaugeCfg,{consumed:full},r.now);
  if(songResult){const streak=result.outcome==='lose'?0:songResult.streak,old=song.readLevel(p,zone,r.now),lv=result.outcome==='lose'?0:streak>0?Math.max(old,song.levelFromStreak(streak)):Math.max(0,old-1);p.bardStreak=song.nextStreak(streak,zone,lv,r.now);p.bardScore=song.newChallenge(lv);}
  if(sanctum.canKnock(eq.job_eq))await sanctum.knock(zone,zone,1,'isolated',r.now,r.id,eq.job_eq.itemId,eq.job_eq.itemName);
  return { result, ms, rounds, stats, job:structuredClone(eq.job_eq||null) };
}
async function recordBattle(r,result,stats,zone,job) {
  await recordQuestBattleProgress({questService:r.questService,jobBadgeService:r.jobBadgeService},r.id,result.outcome,result.totalDamage,result.combatStats,stats.weaponType,zone,job,result.damageTaken,result.healDone,result.lifestealDone);
}
async function settle(r, monster, zone, totalDamage) {
  const state={participants:[r.id],damageMap:{[r.id]:{damage:totalDamage,name:'isolated'}}};
  const rewardLines=[],session={monsterMaxHp:monster.calc.maxHp};
  const context={state,discordId:r.id,zoneKey:zone,monster,sc:r.sc,displayName:'isolated',totalDamage,session,rewardLines};
  const result=await grantKillCurrencyAndExp(context);
  await grantKillDrops({...result,...context});
  await r.questService.recordProgress(r.id,'battle_win',1);
  return result.perPidRewards[r.id];
}
module.exports={fight,settle,recordBattle};
