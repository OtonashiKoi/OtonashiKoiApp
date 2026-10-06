'use strict';
const {randomUUID}=require('crypto');
const {calculateBattleTickMs}=require('../../shared/battleTiming');
const {get:avatar}=require('./avatarCache');
class ZoneCombatVitals {
  constructor(now=Date.now){this.now=now;this.players=new Map();}
  register(scene,{actorId,actorName,maxPlayerHp,finalPlayerHp,schedule,startedAt}){
    const maxHp=Math.round(Number(maxPlayerHp)||0);if(maxHp<=0)return schedule.endsAt;
    const tick=scene.attackTickMs ||= calculateBattleTickMs(scene.monsterAgi||1);
    const epoch=scene.attackEpoch ||= startedAt;
    const first=epoch+Math.max(0,Math.ceil((startedAt-epoch-tick/2)/tick))*tick;
    const id=String(actorId),prior=this.players.get(id),events=prior?.zone===scene.zone?prior.events.slice():[];
    events.push({id:randomUUID(),at:startedAt,hp:maxHp,kind:'reset',damage:0,encounterId:scene.encounterId});
    const rounds=new Map();
    for(const row of schedule.events){
      const e=row.event;if(e.target!=='player'||!['hit','miss','heal'].includes(e.type))continue;
      const round=row.roundIndex||0,segment=rounds.get(round)||0;rounds.set(round,segment+1);
      const at=first+round*tick+tick/2+segment*120;
      events.push({id:randomUUID(),at,hp:Number.isFinite(e.hp)?Math.max(0,e.hp):null,damage:Math.max(0,Number(e.value)||0),kind:e.type,encounterId:scene.encounterId});
    }
    const endsAt=Math.max(schedule.endsAt,...events.filter(e=>e.encounterId===scene.encounterId).map(e=>e.at));
    const final=Math.max(0,Math.min(maxHp,Number(finalPlayerHp)));
    events.push({id:randomUUID(),at:endsAt,hp:final,kind:'final',damage:0,encounterId:scene.encounterId});
    if(final===0)events.push({id:randomUUID(),at:endsAt+30000,hp:maxHp,kind:'reset',damage:0,encounterId:null});
    events.sort((a,b)=>a.at-b.at);
    // Only retain enough history for current HP and visible contacts; never invent random damage.
    const old=events.filter(e=>e.at<this.now()-1500);
    let baseHp=prior?.baseHp??maxHp;for(const e of old){if(e.hp!=null)baseHp=e.hp;else if(e.kind==='hit')baseHp-=e.damage;else if(e.kind==='heal')baseHp+=e.damage;}
    this.players.set(id,{actorId:id,name:actorName,avatarUrl:avatar(id)||null,zone:scene.zone,maxHp,baseHp,events:events.filter(e=>e.at>=this.now()-1500),lastAt:this.now()});
    return endsAt;
  }
  capAtDeath(scene){
    if(!scene.deathAt)return;
    for(const actor of this.players.values())if(actor.zone===scene.zone){
      for(const e of actor.events)if(e.encounterId===scene.encounterId&&e.at>scene.deathAt)e.at=scene.deathAt;
      actor.events.sort((a,b)=>a.at-b.at);
    }
  }
  snapshot(zone){
    const out=[];for(const[id,p]of this.players){if(this.now()-p.lastAt>180000){this.players.delete(id);continue;}if(p.zone===zone){const{lastAt,zone:_zone,...view}=p;out.push(view);}}return out;
  }
}
module.exports={ZoneCombatVitals};
