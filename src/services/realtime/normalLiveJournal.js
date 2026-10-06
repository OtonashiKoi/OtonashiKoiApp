"use strict";
const {createHash}=require('crypto');
function encounterKey(zone,seq,state){const count=state?.killCount;const total=count&&typeof count==='object'?Object.values(count).reduce((n,v)=>n+(Number(v)||0),0):Number(count)||0;return `${zone}:${Number(seq)}:${total}`;}
function rewardId(state,pid,kind){return 'normal-live:'+createHash('sha256').update(`${state.normalLive.encounterKey}:${pid}:${kind}`).digest('hex');}
async function plan(sc,zone,key,pid,kind,make){
  const field=`${pid}_${kind}`;
  for(let i=0;i<6;i++){
    const state=await sc.monsterService.getState(zone);
    if(state.normalLive?.encounterKey!==key||Number(state.currentHp)>0||state.activeTransition||state.activeEvent)throw Error('Live reward encounter changed');
    if(Object.hasOwn(state.normalLive.rewardPlans||{},field))return structuredClone(state.normalLive.rewardPlans[field]);
    const value=await make();state.normalLive.rewardPlans={...state.normalLive.rewardPlans,[field]:value};
    if(await sc.monsterService.saveStateIfActiveMonster(state,zone,state.activeMonsterSeq,state.currentHp))return structuredClone(value);
  }
  throw Error('Live reward plan CAS failed');
}
async function planMany(sc,zone,key,requests){
  if(!requests.length)return {};
  const rolled=new Map();
  for(let attempt=0;attempt<6;attempt++){
    const state=await sc.monsterService.getState(zone);
    if(state.normalLive?.encounterKey!==key||Number(state.currentHp)>0||state.activeTransition||state.activeEvent)throw Error('Live reward encounter changed');
    const plans={...(state.normalLive.rewardPlans||{})};let changed=false;
    for(const {pid,kind,make} of requests){
      const field=`${pid}_${kind}`;
      if(Object.hasOwn(plans,field))continue;
      if(!rolled.has(field))rolled.set(field,await make());
      plans[field]=rolled.get(field);changed=true;
    }
    if(!changed)return structuredClone(plans);
    state.normalLive.rewardPlans=plans;
    if(await sc.monsterService.saveStateIfActiveMonster(state,zone,state.activeMonsterSeq,state.currentHp))return structuredClone(plans);
  }
  throw Error('Live reward batch plan CAS failed');
}
async function forPlayers(players,work,limit=16){
  for(let i=0;i<players.length;i+=limit){
    const results=await Promise.allSettled(players.slice(i,i+limit).map(work));
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  }
}
async function grantInventoryBatch(sc,grants){
  if(sc.progressRepository.grantInventoryRewardsBatch)return sc.progressRepository.grantInventoryRewardsBatch(grants);
  const receipts={};
  await forPlayers(grants,async grant=>{
    const entries=await grantInventory(sc,grant.playerId,grant.id,grant.entries,Infinity,grant.stack);
    (receipts[grant.playerId]||={})[grant.id]=entries;
  });
  return receipts;
}
module.exports={encounterKey,rewardId,plan,planMany,forPlayers,grantInventoryBatch};
async function grantInventory(sc,pid,id,entries,cap=Infinity,stack=false){
  const {countsTowardCapacity}=require('../backpack/backpackService');
  for(let i=0;i<6;i++){
    const progress=await sc.progressRepository.findByPlayerId(pid,{includeLiveRewardReceipts:true});
    if(!progress)throw Error('Live reward player missing');
    const prior=(progress.normalLiveDropReceipts||[]).find(r=>r.id===id);
    if(prior)return structuredClone(prior.entries);
    const next=structuredClone(progress);next.inventory ||= [];
    const effectiveCap=typeof cap==='function'?await cap(progress):cap;
    let room=Math.max(0,effectiveCap-next.inventory.filter(countsTowardCapacity).length);const picked=[];
    for(const entry of entries){
      if(countsTowardCapacity(entry)){if(room<=0)continue;room--;}
      if(!stack||!require('../battle/battleRewardRules').tryStackGem(next,entry.itemId))next.inventory.push(structuredClone(entry));
      picked.push(structuredClone(entry));
    }
    next.normalLiveDropReceipts=[...(progress.normalLiveDropReceipts||[]),{id,entries:picked}];next.updatedAt=new Date().toISOString();
    if(await sc.progressRepository.saveIfUnchanged(next,progress.updatedAt))return picked;
  }
  throw Error('Live inventory receipt CAS failed');
}
module.exports.grantInventory=grantInventory;
