"use strict";
const {LIVE_ZONES:NORMAL_ZONES}=require('../../shared/encounterGroup');
const {encounterKey}=require('./normalLiveJournal');
async function recoverPendingLiveRewards(sc,zone,engine){
  const state=await sc.monsterService.getState(zone),live=state?.normalLive;
  if(!live?.encounterKey||live.settlementComplete||Number(state.currentHp)>0||state.activeTransition||state.activeEvent)return;
  if(live.encounterKey!==encounterKey(zone,state.activeMonsterSeq,state))return;
  const monsters=await sc.monsterService.listMonsters({includeDisabled:false,zone});
  const monster=monsters.find(m=>Number(m.seq)===Number(state.activeMonsterSeq)),first=Object.entries(live.actors||{})[0];
  if(monster&&sc.liveSettlementRepository&&require('../../shared/encounterGroup').NORMAL_ZONES.has(zone)){
    const room={sc,zone,monster,seq:Number(monster.seq),members:new Map(Object.entries(live.actors||{}).map(([id,a])=>[id,{...a,actorId:id,actorName:a.name}])),deathAt:engine?.scene.scenes.get(zone)?.deathAt||Date.now(),encounterId:engine?.scene.scenes.get(zone)?.encounterId};
    const detached=require('./normalLiveSettlement'),job=await detached.capture(sc,room,state);
    if(job){detached.settle(sc,job,rewards=>engine?.presentSettlementRewards(job,rewards)).catch(e=>console.error('[DetachedLiveRewards]',job.key,e.message));return;}
  }
  if(monster&&(first||Object.keys(live.npcs||{}).length))await require('../battle/monsterKillSettlement').handleMonsterKill({serviceContext:sc,zoneKey:zone,monster,state,discordId:first?.[0]||null,displayName:first?.[1].name||null,session:{monsterName:monster.name},resumeLiveSettlement:!!live.killReceipt});
}
async function recoverNormalLive(sc,engine,zones=NORMAL_ZONES,detached=false){
  const restoreVital=(id,v)=>{
    const recoverAt=Number(v.recoverAt)||0,remaining=recoverAt-engine.now();
    if(Number(engine.vitals.get(id)?.recoverAt)>Math.max(engine.now(),recoverAt))return;
    if(remaining>0){const lock=require('../progress/battleLock').acquireWebBattle(id,'web',remaining);if(!lock.ok)lock.active.expiresAt=Math.max(lock.active.expiresAt,Date.now()+remaining);}
    engine.vitals.set(id,{...v,at:engine.now(),actorId:id,events:[],active:false,recoverAt});
  };
  for(const zone of zones){
    let state=await sc.monsterService.getState(zone);
    if (state.pendingLivePotion) state = await require("./liveBattlePotions").recover({ sc, zone, seq: state.activeMonsterSeq, members: new Map() }, engine, state);
    await require("./liveRiichi").flush(sc, state);
    if(Number(state?.currentHp)>0&&!state.activeTransition&&!state.activeEvent&&Number(state.coopMaxHp)>0){
      const monster=(await sc.monsterService.listMonsters({zone})).find(m=>Number(m.seq)===Number(state.activeMonsterSeq));
      if(monster){const scaled=require("../monster/normalCoopScaling").scaleNormalMonster(state,monster,state.damageMap);
        if(scaled.coopMaxHp!==state.coopMaxHp){const next={...state,...scaled};if(!await sc.monsterService.saveStateIfActiveMonster(next,zone,state.activeMonsterSeq,state.currentHp))throw Error("HP normalization CAS conflict");state=next;}
      }
    }
    for(const[id,death]of Object.entries(state?.normalLiveDeath||{}))if(Number(death.recoverAt)>engine.now())restoreVital(id,{zone,id:death.id,name:death.name,maxHp:death.maxHp,baseHp:death.kind==='retreat'?death.hp:0,recoverAt:death.recoverAt,retreated:death.kind==='retreat'});
    const live=state?.normalLive;if(!live)continue;
    let changed=false;
    for(const npc of Object.values(live.npcs||{}))if(npc.selected){npc.selected=false;changed=true;}
    for(const [id,a]of Object.entries(live.actors||{})){
      // Journals from before durable recovery had already used legacy settlement.
      // Never replay their resources or rewards against a later spawn.
      if(!Object.hasOwn(a,"recovery")){if(a.active){a.active=false;a.interruptedAt=engine.now();changed=true;}continue;}
      const progress=await sc.progressRepository.findByPlayerId(id);
      if (a.entry && progress?.hutaoEntryPending?.id === a.id) await require("./hutaoLiveEntry").commit(sc, id, a.entry);
      if(sc.progressRepository.hasLiveSessionReceipt?await sc.progressRepository.hasLiveSessionReceipt(id,a.id):(progress?.normalLiveSessionReceipts||[]).includes(a.id))continue;
      if(a.interruptedAt&&!a.active)continue;
      // Stop, rather than replay, interrupted sessions. Resource consumption and
      // the acknowledgment commit together before any player request is accepted.
      const r=a.result||{},fields={},recovery=a.recovery||{};
      for(const [field,module]of [['shadowGauge','shadowGauge'],['oniGauge','oniGauge'],['sniperGauge','sniperGauge'],['sageGauge','sageGauge'],['diceGauge','diceGauge']])if(r[field]!=null)fields[field]=require('../../shared/'+module).next(r[field],zone);
      if(r.diceLuck!=null)fields.diceLuck=require('../../shared/diceGauge').nextLuck(r.diceLuck);
      if(r.sunSpirit)fields.sunSpirit=require('../../shared/sunSpirit').next(r.sunSpirit.hpPct,zone);
      if(r.windDirectionStep!=null)fields.windDirectionStep=require('../../shared/windDirection').normalizeStep(r.windDirectionStep);
      if(a.result&&recovery.comboBefore!=null)fields.zoneCombo=require('../../shared/zoneCombo').nextCombo(recovery.comboBefore,zone,Number(a.hp)<=0?'lose':'timeout',engine.now(),{hasDeathGuard:recovery.comboBenefits,diedOnce:recovery.diedOnce,consumed:recovery.comboConsumed,spend:Number(r.jobSkillComboSpent)||0});
      if(a.result&&recovery.berserkGauge)fields.berserkGauge=recovery.berserkGauge;
      if(a.leftAt&&fields.zoneCombo)fields.zoneCombo.count=Math.max(0,fields.zoneCombo.count-1);
      if(a.leftAt&&fields.berserkGauge)fields.berserkGauge={...fields.berserkGauge,count:Math.max(0,fields.berserkGauge.count-1)};
      fields.normalLiveSessionReceipts=[...(progress?.normalLiveSessionReceipts||[]),a.id];
      await sc.progressRepository.updateFields(id,fields);
      const recoverAt=Math.max(0,Number(a.recoverAt)||0),remaining=recoverAt-engine.now();
      const payload={zone,liveBattleId:a.id,livePending:false,outcome:Number(a.hp)<=0?'lose':'interrupted',playerName:a.name,playerMaxHp:a.maxHp,finalPlayerHp:a.hp,finalMonsterHp:state.currentHp,logs:r.roundLogs||[],rewardLines:['伺服器重啟，本場停止；已造成的傷害保留。'],drops:[],cooldownMs:Math.max(500,remaining)};
      if(a.leftAt){payload.liveRetreated=true;payload.recoveryUntil=recoverAt;}
      engine.results.set(id,{at:engine.now(),payload});restoreVital(id,{zone,id:a.id,name:a.name,maxHp:a.maxHp,baseHp:a.hp,recoverAt,retreated:Boolean(a.leftAt)});
      a.active=false;a.interruptedAt=engine.now();changed=true;
    }
    if(changed&&!state.activeTransition&&!state.activeEvent&&!await sc.monsterService.saveStateIfActiveMonster(state,zone,state.activeMonsterSeq,state.currentHp))throw Error('Live recovery CAS conflict');
    if(!detached){
      await require("./normalLiveSettlement").recover(sc,zone,engine,true);
      await recoverPendingLiveRewards(sc,zone,engine);
    }
  }
}
module.exports={recoverNormalLive,recoverPendingLiveRewards};
