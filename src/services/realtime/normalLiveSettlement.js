"use strict";
const {NORMAL_ZONES}=require('../../shared/encounterGroup');
const running=new Map();
const finish=(...args)=>require('../battle/finishMonsterKill').finishMonsterKill(...args);
async function prepareRewardCatalog(sc,monster,zone) {
  const rules=require('../battle/battleRewardRules');
  const pool=await rules.buildMonsterDropPool(sc,monster);
  const gems=rules.getParticipationGemTiers(zone,monster).map(t=>require('../battle/zoneBattleState').ENHANCE_GEM_IDS[t]);
  const ids=[...new Set([...pool.map(d=>d.itemId),...gems].filter(Boolean))];
  const items=sc.itemRepository.findByIds?await sc.itemRepository.findByIds(ids):await Promise.all(ids.map(id=>sc.itemRepository.findById(id)));
  return {pool,items:items.filter(Boolean)};
}
function scopedContext(sc,job){
  const repo=sc.liveSettlementRepository;
  const service=Object.create(sc.monsterService);
  service.getState=async()=>{const row=await repo.find(job.key);return {...row.state,liveSettlementRevision:row.revision};};
  service.saveStateIfActiveMonster=async(state)=>repo.saveState(job.key,state,state.liveSettlementRevision);
  const items=new Map((job.catalog?.items||[]).map(i=>[i.id,i]));
  const itemRepository=Object.create(sc.itemRepository);
  itemRepository.findById=async id=>items.get(id)||sc.itemRepository.findById(id);
  itemRepository.findByIds=async ids=>{
    const missing=ids.filter(id=>!items.has(id));
    const extra=missing.length?(sc.itemRepository.findByIds?await sc.itemRepository.findByIds(missing):await Promise.all(missing.map(id=>sc.itemRepository.findById(id)))):[];
    return [...ids.filter(id=>items.has(id)).map(id=>items.get(id)),...extra.filter(Boolean)];
  };
  const progressRepository=Object.create(sc.progressRepository);
  if(job.rewardProgress)progressRepository.findRewardProgressByPlayerIds=async ids=>structuredClone(job.rewardProgress.filter(p=>ids.includes(p.playerId)));
  return {...sc,monsterService:service,itemRepository,progressRepository};
}
async function handoff(sc,job){
  const current=await sc.monsterService.getState(job.zone);
  // A crash after the transition save must not advance a second encounter.
  if(current.normalLive?.encounterKey===job.key&&require('./normalLiveJournal').encounterKey(job.zone,current.activeMonsterSeq,current)===job.key&&!current.activeTransition&&!current.activeEvent&&Number(current.currentHp)<=0){
    await finish({state:job.state,monster:job.monster,sc,zoneKey:job.zone,mergedDmg:job.state.damageMap||{},perPidRewards:{},rewardLines:[],discordId:job.discordId,transitionOnly:true});
  }
  await sc.liveSettlementRepository.handoff(job.key);
}
async function capture(sc,room,state){
  if(!NORMAL_ZONES.has(room.zone)||!sc.liveSettlementRepository||!Object.values(state.damageMap||{}).some(v=>Number(v?.damage)>0||Number(v?.assist)>0))return null;
  const key=state.normalLive.encounterKey;
  let job=await sc.liveSettlementRepository.find(key);
  if(!job){
    const claimed=state.normalLive.killReceipt||await sc.monsterRepository.claimKill(room.zone,room.seq);
    if(!claimed)throw Error('Live settlement claim unavailable');
    const snapshot=structuredClone(state);snapshot.normalLive.killReceipt=true;
    const first=[...room.members.values()].find(a=>!a.done)||[...room.members.values()][0];
    const catalog=room.rewardCatalogReady||null;
    const pids=Object.keys(snapshot.damageMap||{}).filter(pid=>Number(snapshot.damageMap[pid]?.damage)>0||Number(snapshot.damageMap[pid]?.assist)>0);
    const rewardProgress=sc.progressRepository.findRewardProgressByPlayerIds?await sc.progressRepository.findRewardProgressByPlayerIds(pids):null;
    job=await sc.liveSettlementRepository.create({key,zone:room.zone,state:snapshot,monster:room.monster,discordId:first?.actorId||null,displayName:first?.actorName||null,deathAt:room.deathAt,encounterId:room.encounterId,catalog,rewardProgress});
  }
  await handoff(sc,job);
  return job;
}
function settle(sc,job,onRewardsReady){
  if(job.status==='complete')return Promise.resolve([]);
  if(running.has(job.key))return running.get(job.key);
  const work=(async()=>{
    const scoped=scopedContext(sc,job),state=await scoped.monsterService.getState(job.zone);
    const lines=await require('../battle/monsterKillSettlement').handleMonsterKill({serviceContext:scoped,zoneKey:job.zone,monster:job.monster,state,discordId:job.discordId,displayName:job.displayName,session:{monsterName:job.monster.name},resumeLiveSettlement:true,detachedSettlement:true,preparedRewardCatalog:job.catalog,onRewardsReady});
    await sc.liveSettlementRepository.complete(job.key,lines._perPidRewards||{});
    return lines;
  })().finally(()=>running.delete(job.key));
  running.set(job.key,work);return work;
}
async function recover(sc,zone,engine,recoverResources=false){
  if(!sc.liveSettlementRepository)return;
  for(const job of await sc.liveSettlementRepository.pending(zone)){
    if(running.has(job.key))continue;
    await handoff(sc,job);
    // Resource receipts from the old encounter survive even after a new spawn.
    if(recoverResources)await require('./normalLiveRecovery').recoverNormalLive(scopedContext(sc,job),engine,[zone],true);
    settle(sc,job,rewards=>engine?.presentSettlementRewards(job,rewards)).catch(error=>console.error('[DetachedLiveRewards]',job.key,error.message));
  }
}
module.exports={prepareRewardCatalog,capture,settle,recover,scopedContext,handoff};
