"use strict";
const {randomUUID}=require('crypto');
const {runCombatLoop}=require('../../shared/combatLoop');
const {buildTimeline}=require('../../shared/battlePresentationParser');
const {normalMaxHp}=require('../monster/normalCoopScaling');
const {encounterCount}=require('../../shared/encounterGroup');
const {selectedCompanions,companionEffects}=require('./starterCompanions');
const {collectEquipmentEffects}=require('../../shared/effectEngine');
const {scaleSupportPartyEffects}=require('../../shared/supportAuraScaling');
const {beginMonsterAction,monsterCardOptions,recordMonsterAction}=require('./monsterActionClock');
const RECOVERY_MS=30000;
function syncCompanions(room,state,at,members=room.members){
  if(!room.companions?.length)return false;
  const selected=new Set(selectedCompanions(room.zone,members,state));
  state.normalLive.npcs={...state.normalLive.npcs};
  let changed=false;
  for(const npc of room.companions){
    const prior=state.normalLive.npcs[npc.key];
    const value=prior?{...prior}:{hp:npc.stats.maxHp,maxHp:npc.stats.maxHp,attackAt:at+300,enemyTurns:0,recoverAt:0,damage:0,level:npc.level,revision:npc.revision};
    if(prior&&prior.revision!==npc.revision){
      const ratio=Math.min(1,Math.max(0,Number(prior.hp)/Math.max(1,Number(prior.maxHp)||npc.stats.maxHp)));
      value.maxHp=npc.stats.maxHp;value.hp=prior.hp>0?Math.max(1,Math.round(ratio*value.maxHp)):0;
      npc.session={};npc.result=null;
    }
    if(selected.has(npc.key)&&value.hp<=0&&value.recoverAt<=at){value.hp=value.maxHp;value.recoverAt=0;value.attackAt=at+300;npc.session={};npc.result=null;}
    // Returning NPCs keep their HP and cooldown; joins cannot manufacture a heal
    // or an extra attack. A past-due attack starts a fresh cadence on selection.
    if(selected.has(npc.key)&&!value.selected)value.attackAt=Math.max(value.attackAt,at+300);
    value.selected=selected.has(npc.key)&&value.hp>0;value.revision=npc.revision;
    if(JSON.stringify(prior)!==JSON.stringify(value))changed=true;
    state.normalLive.npcs[npc.key]=value;
  }
  return changed;
}
function advanceCompanions(room,state,{at,enemy,enemyHp,contacts,health,clock=beginMonsterAction(room,state,at,enemy)}){
  let changed=syncCompanions(room,state,at);
  for(const npc of room.companions||[]){
    const saved=state.normalLive.npcs[npc.key];
    if(!saved?.selected||saved.hp<=0||(!enemy&&saved.attackAt>at)||state.currentHp<=0)continue;
    const startMonsterHp=enemy?enemyHp:state.currentHp;
    const selfEffects=scaleSupportPartyEffects(collectEquipmentEffects(npc.equipped,'passive',{equipped:npc.equipped,inventory:[],zone:room.zone}).filter(e=>e.target==='party').map(e=>({...e,isSelfAura:true,sourceNpcId:npc.actorId,sourceName:npc.actorName,sourceJobName:npc.jobName})),{providerStats:npc.stats,equipped:npc.equipped});
    const options={playerName:npc.actorName,playerLevel:npc.level,equipped:npc.equipped,inventory:[],partyEffects:[...companionEffects(room,state),...selfEffects],
      monsterEquipped:room.monster.equipment||{},monsterElement:room.monster.element,monsterElementLevel:room.monster.elementLevel,monsterLevel:room.monster.level,monsterIsBoss:!!room.monster.isBoss,
      actionSession:npc.session||(npc.session={}),partyActorId:npc.actorId,liveNormalCombat:true,startPlayerHp:saved.hp,startMonsterHp,
      encounterCount:encounterCount(state,room.monster),encounterUnitHp:normalMaxHp(state,room.monster)/encounterCount(state,room.monster),
      skipPlayerAttack:enemy,skipMonsterAttack:!enemy,monsterActionRound:saved.enemyTurns+1,tickJobSkillCooldowns:!enemy,...monsterCardOptions(clock,npc.result)};
    const result=runCombatLoop(npc.stats,room.monster.calc,room.monster.name,normalMaxHp(state,room.monster),15,options);
    if(![result.finalMonsterHp,result.finalPlayerHp,result.totalDamage].every(Number.isFinite))throw Error('Invalid starter companion action');
    recordMonsterAction(clock,result,startMonsterHp);
    const damage=Math.min(state.currentHp,Math.max(0,Math.round(result.totalDamage)));
    state.currentHp=Math.max(0,state.currentHp-damage);saved.damage+=damage;saved.hp=result.finalPlayerHp;saved.maxHp=result.playerMaxHp||saved.maxHp;saved.lastAt=at;
    if(enemy)saved.enemyTurns++;else saved.attackAt=at+npc.tick;
    if(saved.hp<=0){saved.recoverAt=at+RECOVERY_MS;saved.selected=false;}
    npc.result=result.cumulative;changed=true;
    let budget=damage;
    for(const event of buildTimeline(result.roundLogs,npc.actorName,room.monster.name,result.diceEvents)){
      if(event.target==='enemy'&&['hit','miss'].includes(event.type)){
        const dealt=event.type==='hit'?Math.min(budget,Math.max(0,Number(event.value)||0)):0;budget-=dealt;
        contacts.push({id:randomUUID(),at,actorId:npc.actorId,actorName:npc.actorName,weaponType:npc.stats.weaponType,kind:event.type,damage:dealt,crit:!!event.crit,fx:event.fx||'hit'});
      }
      if(event.target==='player'&&['hit','miss','heal'].includes(event.type))health.push({actorId:npc.actorId,id:randomUUID(),at,hp:saved.hp,kind:event.type,damage:Math.max(0,Number(event.value)||0)});
    }
    if(budget>0)contacts.push({id:randomUUID(),at,actorId:npc.actorId,actorName:npc.actorName,weaponType:npc.stats.weaponType,kind:'hit',damage:budget,crit:false,fx:'hit'});
    state.lastHitAt=new Date(at).toISOString();
  }
  return changed;
}
function companionSnapshot(room,state,at,health=[]){
  if(!room||room.closed||!state?.normalLive)return [];
  return (room.companions||[]).filter(n=>{const value=state.normalLive.npcs?.[n.key];return value?.selected||(value?.hp<=0&&value.recoverAt>at);}).map(n=>{
    const value=state.normalLive.npcs[n.key];
    return {actorId:n.actorId,name:n.actorName,avatarUrl:n.avatarUrl,isNpc:true,level:n.level,jobName:n.jobName,role:n.role,
      maxHp:value.maxHp,baseHp:value.hp,active:value.hp>0,recoverAt:value.recoverAt,events:health.filter(e=>e.actorId===n.actorId),at};
  });
}
module.exports={RECOVERY_MS,syncCompanions,advanceCompanions,companionSnapshot};
