'use strict';
const {createHash}=require('node:crypto');
const clone=structuredClone;
const hpRows=members=>members.map(m=>({discordId:m.discordId,name:m.name,hp:m.currentHp,maxHp:m.maxHp}));
function auraSnapshot(e){return {key:e.key,sourceDiscordId:e.sourceDiscordId,sourceName:e.sourceName,sourceJobName:e.sourceJobName,trigger:e.trigger,target:e.target,params:clone(e.params||{})};}
function startRun(room,time){room.testTelemetry={_id:room.runId,schemaVersion:1,roomId:room._id,seasonKey:room.seasonKey,difficulty:room.difficulty,startedAt:new Date(time).toISOString(),status:'climbing',clearedFloor:0,codeVersion:require('./partyTowerLiveCombat').codeVersion,
 members:room.members.map(m=>({discordId:m.discordId,name:m.name,characterSlot:m.progressSnapshot?.activeCharacterSlot||1,level:m.level,job:m.job,towerRole:m.towerRole,stats:clone(m.stats),maxHp:m.maxHp,equipment:Object.fromEntries(Object.entries(m.equipped||{}).map(([slot,e])=>[slot,{itemId:e?.itemId,enhanceLevel:e?.enhanceLevel||0}]))})),floors:[]};}
function beginFloor(room,floor,time,monster){if(!room.testTelemetry)return;room.testTelemetry.floors.push({floor,startedAt:new Date(time).toISOString(),status:'climbing',monster:{...clone(room.monsterPreview),id:monster?.id||monster?._id||null,baseStats:clone(monster?.calc||{})},initialHp:hpRows(room.members),lastHp:hpRows(room.members),lastMonsterHp:room.monsterPreview.hp,actions:0,players:room.members.map(m=>({discordId:m.discordId,name:m.name,damageDealt:0,hpLost:0,auraHealingReceived:0,auraHealingProvided:0})),deaths:[],auraStates:[],omittedAuraStates:0});}
function recordAction(room,action,time){const f=room.testTelemetry?.floors.at(-1);if(!f)return;f.actions++;
 const states=action.partyAuras||[];const key=createHash('sha256').update(JSON.stringify(states)).digest('hex');let state=f.auraStates.find(x=>x.key===key);
 if(!state&&f.auraStates.length<64){state={key,firstAction:f.actions,actions:0,effects:clone(states)};f.auraStates.push(state);}if(state){state.actions++;state.lastAction=f.actions;}else f.omittedAuraStates++;
 const actor=f.players.find(x=>x.discordId===action.actorId);if(actor)actor.damageDealt+=Math.max(0,f.lastMonsterHp-action.monsterHpAfter);
 for(const heal of action.partyHealing||[]){const recipient=f.players.find(x=>x.discordId===heal.discordId);if(recipient)recipient.auraHealingReceived+=heal.amount; if(actor)actor.auraHealingProvided+=heal.amount;}
 for(const after of action.partyHpAfter||[]){const before=f.lastHp.find(x=>x.discordId===after.discordId),p=f.players.find(x=>x.discordId===after.discordId);if(!before||!p)continue;
  const healing=(action.partyHealing||[]).filter(h=>h.discordId===after.discordId).reduce((n,h)=>n+h.amount,0);p.hpLost+=Math.max(0,before.hp+healing-after.hp);
  if(before.hp>0&&after.hp<=0)f.deaths.push({discordId:after.discordId,name:after.name,floor:f.floor,action:f.actions,at:new Date(time).toISOString(),hpBefore:before.hp,maxHp:after.maxHp,actorType:action.type,actorId:action.actorId||null,actorName:action.name,targetId:action.targetId||null,reason:action.type==='monster'?'怪物行動後倒地':'自身／隊友行動後倒地',evidence:(action.logs||[]).slice(-8),auraStateKey:state?.key||null});
 }
 f.lastHp=clone(action.partyHpAfter||f.lastHp);f.lastMonsterHp=action.monsterHpAfter;
}
function completeFloor(room,result,time){const f=room.testTelemetry?.floors.at(-1);if(!f)return;f.endedAt=new Date(time).toISOString();f.status=result.monsterKilled&&result.survived?'cleared':'failed';f.finalHp=hpRows(room.members);f.summary=clone(result.summary||{});f.failureAnalysis=clone(room.lastFloorResult?.failureAnalysis||null);f.systemRecovery=clone(room.lastFloorResult?.systemRecovery||[]);f.metalRecovery=clone(room.lastFloorResult?.metalRecovery||[]);
 for(const p of f.players){const q=result.memberDamage?.find(x=>x.discordId===p.discordId);if(q){p.damageDealt=q.damageDealt;p.combatStats=clone(q.questStats||{});p.attack=q.atk;p.maxHit=q.maxHit;}}
 room.testTelemetry.clearedFloor=room.clearedFloor;
}
function finishRun(room,reason,time){const t=room.testTelemetry;if(!t)return;t.status=reason?'stopped':'won';t.reason=reason||null;t.endedAt=new Date(time).toISOString();t.clearedFloor=room.clearedFloor;const f=t.floors.at(-1);if(f?.status==='climbing'){f.status='stopped';f.finalHp=hpRows(room.members);f.endedAt=t.endedAt;f.stopReason=reason;} }
module.exports={auraSnapshot,startRun,beginFloor,recordAction,completeFloor,finishRun};
