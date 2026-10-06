"use strict";
const { randomUUID } = require('crypto');
const { buildTimeline, countTimedBattleEvents, isInstantBattleEvent, isBurstContinuation } = require('../../shared/battlePresentationParser');
const { normalMaxHp } = require('../monster/normalCoopScaling');
const { encounterCount, NORMAL_ZONES } = require('../../shared/encounterGroup');
const { playerEventBus } = require('./playerEventBus');
const BUFFER_MS = 750;
const { WEB_MONSTER_TRANSITION_MS, MONSTER_DISSOLVE_MS, WEB_BATTLE_HANDOFF_MS } = require("../../shared/battleTiming");

// Server-authored replay clock. Settlement stays atomic; only public enemy events are shared.
function scheduleEvents(events, tickMs, startedAt) {
  const rounds = []; let frame;
  for (const event of events) {
    if (event.type === 'round') { frame = []; frame.roundIndex=Math.max(0,(Number(event.round)||1)-1); rounds.push(frame); }
    else { if (!frame) { frame = []; rounds.push(frame); } frame.push(event); }
  }
  const out = []; let at = startedAt; let eventIndex = 0;
  for (const [roundIndex,frame] of rounds.entries()) {
    const diceMs = frame.filter(e => e.type === 'dice' && e.dice).reduce((n,e) => n + (e.dice.initialFaces?.length && e.dice.rerolledIndices?.length ? 900 : 620), 0);
    const count = countTimedBattleEvents(frame);
    const duration = Math.max(tickMs, diceMs + (count > 0 ? 180 : 0));
    const delay = count > 0 ? Math.max(24, (duration-diceMs)/count) : duration;
    let saved = 0;
    for (let i=0; i<frame.length; i++) {
      const event = frame[i];
      if (isInstantBattleEvent(event)) continue;
      out.push({ at: Math.round(at), event, index: eventIndex++, roundIndex:Number(frame.roundIndex)||0 });
      let gap = event.type === 'dice' ? (event.dice?.initialFaces?.length && event.dice?.rerolledIndices?.length ? 900 : 620) : delay;
      const next = frame.slice(i+1).find(e => !isInstantBattleEvent(e));
      if (isBurstContinuation(event,next)) { const tight = Math.min(70,delay); saved += delay-tight; gap=tight; }
      else { gap+=saved; saved=0; }
      at += gap;
    }
    if (!frame.length || (!count && !diceMs)) at += duration;
  }
  return { events:out, endsAt:Math.round(at) };
}

class ZoneCombatScene {
  constructor({ now=Date.now, emit=(id,data)=>playerEventBus.emit(id,{type:'zone_combat_scene',data}) }={}) {
    this.vitals=new (require("./zoneCombatVitals").ZoneCombatVitals)(now); this.now=now; this.emit=emit; this.scenes=new Map(); this.watchers=new Map(); this.revision=0; this.runtimeId=randomUUID();
  }
  supports(zone) { return NORMAL_ZONES.has(zone); }
  watch(id,zone) { this.watchers.set(String(id),{zone,at:this.now()}); }
  publicSnapshot(scene) {
    if (!scene) return null;
    const { sessionIds, settledHp, seq, liveActors, ...view } = scene;
    return { ...view, actors:scene.mode==="live" ? this.actorSnapshot?.(scene.zone) || liveActors || [] : this.vitals.snapshot(scene.zone), serverNow:this.now() };
  }
  publish(scene) {
    const data=this.publicSnapshot(scene),now=this.now();
    for(const [id,w] of this.watchers) {
      if(now-w.at>30000) {this.watchers.delete(id);continue;}
      if(w.zone===scene.zone) this.emit(id,data);
    }
  }
  ensure(zone,state,monster,{force=false}={}) {
    if(!this.supports(zone)||!monster) return null;
    let scene=this.scenes.get(zone);
    if(scene && !force && scene.seq===Number(state.activeMonsterSeq)) return scene;
    // Never reveal the next monster while the shared death animation is pending.
    if(scene && !force && scene.deathAt && (scene.transitionPending || this.now()<(scene.advanceAt?scene.advanceAt+WEB_BATTLE_HANDOFF_MS:scene.deathAt+WEB_MONSTER_TRANSITION_MS))) return scene;
    const maxHp=normalMaxHp(state,monster),hp=Math.max(0,Math.min(maxHp,Number(state.currentHp??maxHp)));
    const planned=scene?.next?.seq===Number(state.activeMonsterSeq)?scene.next:null;
    const previous = scene ? {encounterId:scene.encounterId,monster:scene.monster,maxHp:scene.maxHp,deathAt:scene.deathAt,advanceAt:scene.advanceAt,transitionPending:scene.transitionPending} : null;
    scene={mode:this.liveMode?'live':undefined,liveHp:this.liveMode?hp:undefined,runtimeId:this.runtimeId,spawnAt:this.liveMode?(Number(state.normalLiveSpawnAt)||(planned?.spawnAt??(previous?.deathAt?Math.max(this.now(),(previous.advanceAt?previous.advanceAt+WEB_BATTLE_HANDOFF_MS:previous.deathAt+WEB_MONSTER_TRANSITION_MS)):this.now()+(force?BUFFER_MS:0)))):(previous?.deathAt?Math.max(this.now(),previous.deathAt+WEB_MONSTER_TRANSITION_MS):(force?this.now()+BUFFER_MS:0)),previous,zone,seq:Number(state.activeMonsterSeq),encounterId:planned?.encounterId||randomUUID(),revision:++this.revision,
      monster:{id:monster.id,name:monster.name,imageUrl:monster.imageUrl||null,element:monster.element||null,elementLevel:monster.elementLevel||0,level:monster.level||1,encounterCount:encounterCount(state,monster)},
      monsterAgi:Number(monster.calc?.agi)||1,maxHp,baseHp:hp,settledHp:hp,events:[],deathAt:null,sessionIds:new Map()};
    this.scenes.set(zone,scene);this.publish(scene);return scene;
  }
  register({zone,state,monster,actorId,actorName,weaponType,logs,diceEvents,tickMs,beforeHp,afterHp,maxPlayerHp,finalPlayerHp,sessionId=randomUUID()}) {
    const scene=this.ensure(zone,{...state,currentHp:beforeHp},monster);
    if(!scene) return null;
    if(scene.sessionIds.has(sessionId)) return scene.sessionIds.get(sessionId);
    // A CAS-successful settlement may raise HP when additional eligible contributors join.
    const growth=Math.max(0,beforeHp-scene.settledHp);
    scene.baseHp+=growth;scene.maxHp=Math.max(scene.maxHp,normalMaxHp(state,monster));
    const startedAt=this.now()+BUFFER_MS;
    const schedule=scheduleEvents(buildTimeline(logs,actorName,monster.name,diceEvents||[]),tickMs,startedAt);
    let budget=Math.max(0,beforeHp-afterHp);
    const publicEvents=schedule.events.filter(row=>row.event.target==='enemy' && ['hit','miss'].includes(row.event.type));
    for(const row of publicEvents) {
      const e=row.event; const damage=e.type==='hit'?Math.min(budget,Math.max(0,Number(e.value)||0)):0;
      budget-=damage;
      scene.events.push({id:randomUUID(),at:row.at,actorId:String(actorId),actorName,weaponType:weaponType||null,kind:e.type,damage,crit:!!e.crit,fx:e.fx||'hit'});
    }
    // Legacy/unparsed damage must still reach the durable final HP, never disappear.
    if(budget>0) scene.events.push({id:randomUUID(),at:schedule.endsAt,actorId:String(actorId),actorName,weaponType:weaponType||null,kind:'hit',damage:budget,crit:false,fx:'hit'});
    scene.events.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
    scene.settledHp=afterHp;
    if(afterHp<=0) scene.deathAt=Math.max(...scene.events.filter(e=>e.damage>0).map(e=>e.at),startedAt);
    // Keep only the current encounter; compact completed contacts without altering future HP.
    if(scene.events.length>512) {
      const cutoff=this.now()-1500,old=scene.events.filter(e=>e.at<cutoff);
      scene.baseHp=Math.max(0,scene.baseHp-old.reduce((n,e)=>n+e.damage,0));
      scene.events=scene.events.filter(e=>e.at>=cutoff);
    }
    const endsAt=this.vitals.register(scene,{actorId,actorName,maxPlayerHp,finalPlayerHp,schedule,startedAt});
    this.vitals.capAtDeath(scene);
    scene.revision=++this.revision;
    const session={encounterId:scene.encounterId,startedAt,endsAt,deathAt:scene.deathAt};
    scene.sessionIds.set(sessionId,session);this.publish(scene);return session;
  }
  transitionTimes(zone,minimum) {
    const scene=this.scenes.get(zone),death=scene?.deathAt,now=this.now();
    if(!death)return {advanceAt:null,spawnAt:now+minimum};
    // The walk overlaps durable reward settlement; spawning still waits for it.
    const advanceAt=scene.advanceAt||death+MONSTER_DISSOLVE_MS;
    return {advanceAt,spawnAt:Math.max(now,advanceAt+WEB_BATTLE_HANDOFF_MS)};
  }
  transitionDelay(zone,minimum) {return Math.max(0,this.transitionTimes(zone,minimum).spawnAt-this.now());}
  prepareNext(zone,monster,state,timing) {
    const scene=this.scenes.get(zone);if(!scene?.deathAt||scene.mode!=="live")return;
    scene.advanceAt=timing.advanceAt;scene.transitionPending=false;
    scene.next={encounterId:randomUUID(),seq:Number(monster.seq),spawnAt:timing.spawnAt,maxHp:normalMaxHp(state,monster),monster:{id:monster.id,name:monster.name,imageUrl:monster.imageUrl||null,element:monster.element||null,elementLevel:monster.elementLevel||0,level:monster.level||1,encounterCount:encounterCount(state,monster)}};
    scene.revision=++this.revision;this.publish(scene);
  }
  hpAt(scene,at=this.now()) { return Math.max(0,scene.baseHp-scene.events.filter(e=>e.at<=at).reduce((n,e)=>n+e.damage,0)); }
}
const zoneCombatScene=new ZoneCombatScene();
module.exports={zoneCombatScene,ZoneCombatScene,scheduleEvents,BUFFER_MS};
