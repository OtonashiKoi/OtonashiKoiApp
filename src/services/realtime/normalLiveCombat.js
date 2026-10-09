"use strict";
const { randomUUID } = require("crypto");
const { AppError } = require("../../shared/errors");
const { runCombatLoop } = require("../../shared/combatLoop");
const { calculateBattleTickMs, calculateLiveBattleCooldownMs } = require("../../shared/battleTiming");
const { normalMaxHp, scaleNormalMonster } = require("../monster/normalCoopScaling");
const { buildTimeline } = require("../../shared/battlePresentationParser");
const { encounterCount, LIVE_ZONES } = require("../../shared/encounterGroup");
const riichi = require("./liveRiichi"), riichiRules = require("../../shared/hutaoRiichiCard");
const hutaoEntry = require("./hutaoLiveEntry"), livePotions = require("./liveBattlePotions");
const worldBossAnnouncement = require("./liveWorldBossAnnouncement");
const controls = require("./liveControlGauges");
const bossRiichi = require("./hutaoBossRiichi");
const { zoneCombatScene } = require("./zoneCombatScene");
const { playerEventBus } = require("./playerEventBus");
const { beginMonsterAction, monsterCardOptions, recordMonsterAction, saveMonsterClock, applyMonsterHp } = require("./monsterActionClock");
const {companionEffects}=require('./starterCompanions');
const {syncCompanions,advanceCompanions,companionSnapshot}=require('./starterCompanionCombat');
const {liveForEncounter,createLiveRoom,startRoomClock,startStarterRooms}=require('./starterCompanionRooms');

// The only clock advances combat. Requests join a session; they never carry damage,
// HP, rewards, attack timestamps or a client-selected attack frequency.
class NormalLiveCombat {
  constructor({ now=Date.now, scene=zoneCombatScene, emit=(id,data)=>playerEventBus.emit(id,data), auto=true, starterNpcs=true }={}) {
    this.now=now;this.scene=scene;this.emit=emit;this.auto=auto;this.starterNpcs=starterNpcs;
    this.reports=new Map();this.rewardReports=new Map();this.zones=new Map();this.players=new Map();this.queues=new Map();this.results=new Map();this.vitals=new Map();this.scene.liveMode=true;this.scene.actorSnapshot=zone=>this.actorSnapshot(zone);
  }
  supports(zone) { return LIVE_ZONES.has(zone); }
  recoveryUntil(actorId) { return Number(this.vitals.get(String(actorId))?.recoverAt)||0; }
  leaveStatus(actorId,battleId) {
    const v=this.vitals.get(String(actorId));
    return v?.id===battleId&&v.retreated?{recoveryUntil:v.recoverAt,cooldownMs:Math.max(0,v.recoverAt-this.now())}:{};
  }
  async leave(actorId, battleId) {
    actorId=String(actorId);
    const actor=this.players.get(actorId);
    if(!actor||actor.joining||actor.id!==battleId)return {left:false,...this.leaveStatus(actorId,battleId)};
    const zone=actor.initial.zone;
    return this.serial(zone,async()=>{
      const a=this.players.get(actorId),room=this.zones.get(zone);
      if(!a||a.id!==battleId||a.done||!room||room.closed)return {left:false,...this.leaveStatus(actorId,battleId)};
      for(let attempt=0;attempt<6;attempt++){
        const state=await room.sc.monsterService.getState(zone);
        if(Number(state.activeMonsterSeq)!==room.seq||state.normalLive?.actors?.[actorId]?.id!==battleId||state.activeTransition||state.activeEvent||Number(state.currentHp)<=0)throw Object.assign(new Error("戰鬥狀態更新中，請重試脫離戰鬥"),{status:409});
        const candidate=structuredClone(state);
        const leftAt=this.now(),recoverAt=leftAt+calculateLiveBattleCooldownMs({endedAt:leftAt,now:leftAt,lost:true});
        candidate.normalLive.actors[actorId].active=false;
        candidate.normalLive.actors[actorId].leftAt=leftAt;
        candidate.normalLive.actors[actorId].recoverAt=recoverAt;
        syncCompanions(room,candidate,leftAt,new Map([...room.members].filter(([id])=>id!==actorId)));
        candidate.normalLiveDeath={...candidate.normalLiveDeath,[actorId]:{kind:"retreat",id:battleId,recoverAt,name:a.actorName,maxHp:a.maxHp,hp:a.hp}};
        if(!await room.sc.monsterService.saveStateIfActiveMonster(candidate,zone,room.seq,state.currentHp))continue;
        a.retreated=true;a.lastAt=leftAt;a.recoverAt=recoverAt;
        require("../progress/battleLock").acquireWebBattle(actorId,"web",Math.max(0,recoverAt-this.now()));
        this.results.delete(actorId);
        this.finishActor(room,a,candidate,"timeout");
        this.updateScene(room,candidate,[],[]);
        if(!room.companions.length&&[...room.members.values()].every(member=>member.done))this.close(room);
        return {left:true,liveBattleId:battleId,...this.leaveStatus(actorId,battleId)};
      }
      throw Object.assign(new Error("脫離戰鬥尚未成功，請重試"),{status:409});
    });
  }
  async setStance(actorId, battleId, requested) {
    return require("./liveBattleStance").setStance(this, String(actorId), battleId, requested);
  }
  serial(zone,work) {
    const next=(this.queues.get(zone)||Promise.resolve()).catch(()=>{}).then(work);
    this.queues.set(zone,next);return next;
  }
  ready(sc){
    if(!this.recovery)this.recovery=require("./normalLiveRecovery").recoverNormalLive(sc,this).then(async()=>{
      if(this.auto&&!this.rewardRecoveryTimer){this.rewardRecoveryTimer=setInterval(()=>{for(const zone of LIVE_ZONES)this.serial(zone,async()=>{await require("./normalLiveSettlement").recover(sc,zone,this);await require("./normalLiveRecovery").recoverPendingLiveRewards(sc,zone,this);}).catch(e=>console.error("[LiveRewardRecovery]",zone,e.message));},10000);this.rewardRecoveryTimer.unref?.();}
      await startStarterRooms(this,sc);
    });return this.recovery;
  }
  async join({sc,zone,monster,state,actorId,actorName,stats,monsterStats,options,tickMs,onStart}) {
    actorId=String(actorId);
    let promise;
    await this.serial(zone,async()=>{
      if(this.players.has(actorId))throw Object.assign(new Error("你已在即時戰鬥中"),{code:"LIVE_BATTLE_ACTIVE"});
      this.players.set(actorId,{joining:true});
      try {
      const fresh=await sc.monsterService.getState(zone);
      if(Number(fresh.activeMonsterSeq)!==Number(monster.seq)||fresh.activeTransition||fresh.activeEvent||Number(fresh.currentHp)<=0)throw new AppError("scene_transition","怪物已換場，下一批準備中，請稍後重試。",409);
      let room=this.zones.get(zone);
      if(!room||room.seq!==Number(monster.seq)||room.closed) {
        room=await createLiveRoom(this,sc,zone,monster,fresh,monsterStats);
        this.zones.set(zone,room);
      }
      const previous=fresh.normalLiveDeath?.[actorId] || fresh.normalLive?.actors?.[actorId],v=this.vitals.get(actorId);
      if(Math.max(Number(previous?.recoverAt)||0,Number(v?.recoverAt)||0)>this.now())throw Object.assign(new Error(previous?.kind==="retreat"||v?.retreated?"脫離恢復中，請稍後再出戰":"死亡恢復中，請稍後再出戰"),{code:"LIVE_DEATH_COOLDOWN"});
      const id=randomUUID(),start=this.now()+300;
      const a={id,actorId,actorName,stats:structuredClone(stats),monsterStats:structuredClone(monsterStats),options:structuredClone(options),session:{},hp:stats.maxHp,maxHp:stats.maxHp,attackAt:start,tick:tickMs||calculateBattleTickMs(stats.agi||1),attacks:0,logs:[],logPackets:[],actionSeq:0,dice:[],result:null,done:false};
      promise=new Promise((resolve,reject)=>Object.assign(a,{resolve,reject}));
      // Join itself is durable, without giving damage eligibility or growing HP.
      const live=liveForEncounter(fresh,zone,room.seq);
      const candidate={...fresh,normalLiveSpawnAt:room.epoch,normalLive:{...live,actors:{...live.actors,[actorId]:{id,name:actorName,maxHp:a.maxHp,hp:a.hp,active:true,recovery:options.liveRecovery||{},startedAt:this.now()}}}};
      if (zone === controls.ZONE) controls.ensure(candidate, this.now(), options.liveControlSeed);
      const progress = await sc.progressRepository?.findByPlayerId?.(actorId);
      a.riichi = { ...(progress?.hutaoRiichi || {}) };
      candidate.normalLive.actors[actorId].riichi = a.riichi;
      candidate.normalLive.actors[actorId].slot = Number(progress?.activeCharacterSlot || 1);
      candidate.normalLive.actors[actorId].seasonKey = progress?.seasonKey;
      let entry;
      if (zone === hutaoEntry.ZONE) {
        bossRiichi.initialize(candidate, this.now());
        entry = await hutaoEntry.prepare(sc, actorId, actorName, id, this.now());
        candidate.normalLive.actors[actorId].potionPouch = entry.pouch;
        candidate.normalLive.actors[actorId].entry = entry;
      }
      syncCompanions(room,candidate,this.now(),new Map([...room.members,[actorId,a]]));
      const announcement = worldBossAnnouncement.claim(candidate, zone, monster, actorId, actorName, this.now());
      if(!await sc.monsterService.saveStateIfActiveMonster(candidate,zone,monster.seq,fresh.currentHp)) {
        await hutaoEntry.abort(sc, actorId, actorName, entry);
        throw new AppError("scene_transition","共鬥狀態更新中，請稍後重試。",409);
      }
      if (entry) await hutaoEntry.commit(sc, actorId, entry).catch(error => console.error("[HutaoEntry] durable admission pending", error.message));
      room.members.set(actorId,a);this.players.set(actorId,a);
      const scene=this.scene.ensure(zone,candidate,monster);
      this.updateScene(room,candidate,[],[]);
      const initial={liveBattleId:id,livePending:true,playerName:actorName,zone,outcome:"",logs:[],rewardLines:[],drops:[],playerMaxHp:a.maxHp,finalPlayerHp:a.hp,monsterName:monster.name,monsterImageUrl:monster.imageUrl||null,monsterElement:monster.element||null,monsterElementLevel:monster.elementLevel||0,monsterStartHp:candidate.currentHp,monsterMaxHp:normalMaxHp(candidate,monster),encounterCount:encounterCount(candidate,monster),weaponType:stats.weaponType,tickMs:a.tick,sharedScene:this.scene.publicSnapshot(scene)};
      a.initial=initial;
      onStart?.(initial);this.emit(actorId,{type:"normal_live_start",data:{zone,...initial}});
      startRoomClock(this,room);
      if (announcement) worldBossAnnouncement.deliver(sc, announcement).catch(error => console.warn("[LiveWorldBossStart] Discord", error.message));
      } catch(error){if(this.players.get(actorId)?.joining)this.players.delete(actorId);throw error;}
    });
    return promise;
  }
  // Only actors in this live room can lend an aura. Historic zone registrations
  // and the browser being online are not proof of combat participation.
  partyEffects(room, recipient, state) {
    const humans=[...room.members.values()].filter(provider => {
      const hp = state?.normalLive?.actors?.[provider.actorId]?.hp ?? provider.hp;
      return !provider.done && provider.hp > 0 && Number(hp) > 0;
    }).flatMap(provider => (provider.options.partyEffects || [])
      .filter(effect => effect && String(effect.sourceDiscordId || "") === provider.actorId)
      .map(effect => ({ ...effect, isSelfAura: provider.actorId === recipient.actorId })));
    // A human's matching skill takes precedence, including weaker starter
    // builds. NPC auras must not manufacture human assist for an unused aura.
    return humans.concat(companionEffects(room,state).filter(n=>!humans.some(h=>h.key===n.key&&Number(h.params?.value??h.value)>0)));
  }
  action(room,a,state,enemy,clock=beginMonsterAction(room,state,this.now(),enemy)) {
    const command={...a.options,partyEffects:this.partyEffects(room,a,state),actionSession:a.session,partyActorId:a.actorId,liveNormalCombat:true,startPlayerHp:a.hp,startMonsterHp:state.currentHp,encounterUnitHp:normalMaxHp(state,room.monster)/encounterCount(state,room.monster),skipPlayerAttack:enemy,skipMonsterAttack:!enemy,monsterActionRound:(a.enemyTurns||0)+1,tickJobSkillCooldowns:!enemy,monsterActiveEffects:a.result?.monsterActiveEffects||[],stunRoundsLeft:a.result?.stunRoundsLeft||0,monsterStunImmuneUntil:a.result?.monsterStunImmuneUntil||0,monsterKnockbackPending:a.result?.monsterKnockbackPending,sageMistPending:a.result?.sageMistPending,forceMonsterCritFailPending:a.result?.forceMonsterCritFailPending,...monsterCardOptions(clock,a.result)};
    command.allowCoopRevive = room.zone === hutaoEntry.ZONE;
    command.hutaoBossStrike = room.zone === hutaoEntry.ZONE && enemy && clock.hutaoBossRiichi?.outcome === "strike";
    if (room.zone === controls.ZONE) {
      const control = controls.active(state, this.now());
      command.liveControlActive = control.active;
      command.teamStunStyle = control.style;
      command.teamControlContributors = control.contributors;
    }
    const saved = state.normalLive.actors[a.actorId];
    const pulse = room.riichiPulses?.get(a.actorId);
    let stats = riichiRules.timedStats(a.stats, saved?.riichi, this.now());
    if (room.zone === hutaoEntry.ZONE) stats = bossRiichi.playerStats(stats, saved, this.now());
    command.startPlayerHp = saved?.hp ?? a.hp;
    if (!enemy && pulse?.tsumo) {
      command.hutaoRiichiPulse = true;
    }
    command.riichiOnly = !enemy && a.attackAt > this.now();
    command.tickJobSkillCooldowns = !enemy && !command.riichiOnly;
    let monsterStats = a.monsterStats;
    if (room.zone === hutaoEntry.ZONE) {
      const wind = require("../../shared/hutaoEvent").windAt(this.now());
      monsterStats = { ...room.monster.calc, dodge: wind.bossDodgeZero ? 0 : Math.min(95, (room.monster.calc.dodge || 0) + (wind.bossDodgeBonus || 0)),
        finalDamageMultiplier: (room.monster.calc.finalDamageMultiplier || 1) * (wind.bossDamageMultiplier || 1) };
      monsterStats = bossRiichi.monsterStats(monsterStats, state, this.now());
      command.eventPlayerCritDamageMultiplier = wind.playerCritDamageMultiplier || 1;
      command.bossVulnMult = (command.bossVulnMult || 1) * (wind.playerFinalDamageMultiplier || 1);
    }
    command.livePlayerStats = stats; command.liveMonsterStats = monsterStats;
    const result=runCombatLoop(stats,monsterStats,room.monster.name,normalMaxHp(state,room.monster),15,command);
    if (clock.hutaoBossRiichi) result.roundLogs.unshift(bossRiichi.resultText(clock.hutaoBossRiichi.outcome));
    if (pulse && !enemy) result.roundLogs.unshift(pulse.tsumo ? "🀄 立直・自摸！全體共鬥AGI+15，持續15秒。" : "🀄 立直未自摸：全體共鬥LUK+5，持續15秒；自身扣當前HP10%。");
    a.options.playerActiveEffects=command.playerActiveEffects;
    return result;
  }
  async advance(zone) {
    return this.serial(zone,async()=>{
      const room=this.zones.get(zone);if(!room||room.closed)return;
      if(this.auto&&room.companions.length&&require('../access/maintenanceStore').isActive())return;
      const nextHumanAt=Math.min(...[...room.members.values()].filter(a=>!a.done&&a.hp>0)
        .map(a=>Math.min(a.announcedAt===a.attackAt?a.attackAt:a.attackAt-120, riichiRules.hasCard(a.options.equipped) ? Number(a.riichi?.nextAt || this.now()) : Infinity)));
      if(this.now()<Math.min(room.enemyAt,room.npcWakeAt||Infinity,nextHumanAt))return;
      let state=await room.sc.monsterService.getState(zone);
      if (state.pendingLivePotion) state = await livePotions.recover(room, this, state);
      if(Number(state.activeMonsterSeq)!==room.seq||state.activeTransition||state.activeEvent||Number(state.currentHp)<=0) {
        this.failRoom(room,new Error("共鬥怪物已換場，本場停止；已提交傷害保留"));return;
      }
      const at=this.now(),enemy=at>=room.enemyAt,clock=beginMonsterAction(room,state,at,enemy);
      const companionsChanged=syncCompanions(room,state,at);
      for(const a of room.members.values())if(!a.done)require("../progress/battleLock").refreshWebBattle(a.actorId);
      const windups=[...room.members.values()].filter(a=>!a.done&&a.hp>0&&a.attackAt>at&&a.attackAt-at<=120&&a.announcedAt!==a.attackAt);
      if(windups.length){
        const s=this.scene.ensure(zone,state,room.monster);
        for(const a of windups){
          a.announcedAt=a.attackAt;a.windupId=randomUUID();
          s.events.push({id:a.windupId,at:a.attackAt,actorId:a.actorId,actorName:a.actorName,weaponType:a.stats.weaponType,kind:'hit',damage:0,crit:false,fx:'hit'});
        }
        // Publish the complete pulse once, rather than one growing snapshot
        // per actor to every watcher. Each cue retains its own contact clock.
        s.revision=++this.scene.revision;this.scene.publish(s);
      }
      // One enemy pulse targets every currently alive participant. A player's own
      // AGI can suppress that response, but cannot change other players' clock.
      const targets=[...room.members.values()].filter(a=>!a.done&&a.hp>0&&(enemy||a.attackAt<=at||riichi.due(a,at)));
      const npcDue=(room.companions||[]).some(n=>state.normalLive?.npcs?.[n.key]?.selected&&state.normalLive.npcs[n.key].hp>0&&(enemy||state.normalLive.npcs[n.key].attackAt<=at));
      if(!targets.length&&!npcDue&&!companionsChanged) {if(enemy)room.enemyAt=room.epoch+(Math.floor((at-room.epoch)/room.enemyTick)+1)*room.enemyTick;return;}
      const contacts=[],health=[],steps=[];
      let candidate=structuredClone(state);
      if (zone === hutaoEntry.ZONE) clock.hutaoBossRiichi = bossRiichi.claim(candidate, at, enemy, controls.active(candidate, at).active);
      room.riichiPulses = enemy ? new Map() : riichi.prepare(room, candidate, at);
      for(const a of targets) {
        if(candidate.currentHp<=0&&!enemy)break;
        const beforeHp=a.hp;
        const input=enemy?{...candidate,currentHp:state.currentHp}:candidate;
        const prospective=scaleNormalMonster(input,room.monster,{...input.damageMap,[a.actorId]:{...input.damageMap?.[a.actorId],damage:Math.max(1,Number(input.damageMap?.[a.actorId]?.damage)||0)}});
        const result=this.action(room,a,enemy?input:{...input,...prospective},enemy,clock);
        if (![result.finalMonsterHp,result.finalPlayerHp,result.totalDamage].every(Number.isFinite)) throw new Error("Invalid live combat result; damage was not committed");
        recordMonsterAction(clock,result,input.currentHp);
        const map={...candidate.damageMap},prior=map[a.actorId]||{};
        const dealt=Math.max(0,Math.round(Number(result.totalDamage)||0));
        const actual=Math.min(enemy?candidate.currentHp:prospective.currentHp,dealt);
        map[a.actorId]={...prior,name:a.actorName,level:a.options.playerLevel||1,damage:(Number(prior.damage)||0)+actual,taken:(Number(prior.taken)||0)+Math.max(0,Number(result.damageTaken)||0)};
        if (zone === controls.ZONE && !enemy) controls.credit({ ...candidate, damageMap: map }, a.actorId, actual, at);
        const assist=result.combatStats?.supportShotBySource||{};
        for(const[id,value]of Object.entries(result.assistLedger?.bySource||{})){const delta=Number(value)-(Number(a.result?.assistLedger?.bySource?.[id])||0);if(delta>0){const entry=map[id]||{};map[id]={...entry,assist:(Number(entry.assist)||0)+delta};}}
        for(const[id,value]of Object.entries(assist))if(id!==a.actorId&&Number(value)>0){const entry=map[id]||{};map[id]={...entry,damage:(Number(entry.damage)||0)+Number(value)};map[a.actorId].damage=Math.max(Number(prior.damage)||0,map[a.actorId].damage-Number(value));}
        const scaled=scaleNormalMonster(candidate,room.monster,map);
        const monsterHealed=Math.max(0,result.finalMonsterHp-(enemy?input.currentHp:prospective.currentHp)+dealt);
        candidate={...candidate,...scaled,currentHp:Math.max(0,Math.min(normalMaxHp({...candidate,...scaled},room.monster),scaled.currentHp-dealt+(enemy?0:monsterHealed))),damageMap:map,participants:[...new Set([...(candidate.participants||[]),a.actorId])],lastHitAt:new Date(at).toISOString()};
        const timeline=buildTimeline(result.roundLogs,a.actorName,room.monster.name,result.diceEvents);
        let budget=Math.min(scaled.currentHp,dealt),segment=0;
        for(const e of timeline){
          if(e.target==='enemy'&&['hit','miss'].includes(e.type)){
            const damage=e.type==='hit'?Math.min(budget,Math.max(0,Number(e.value)||0)):0;budget-=damage;
            contacts.push({id:!enemy&&a.windupId&&!contacts.some(c=>c.actorId===a.actorId)?a.windupId:randomUUID(),at,actorId:a.actorId,actorName:a.actorName,weaponType:a.stats.weaponType,kind:e.type,damage,crit:!!e.crit,fx:e.fx||'hit'});
          }
          if(e.target==='player'&&['hit','miss','heal'].includes(e.type))health.push({actorId:a.actorId,id:randomUUID(),at,hp:Number.isFinite(e.hp)?e.hp:null,kind:e.type,damage:Math.max(0,Number(e.value)||0),segment:segment++});
        }
        if(budget>0)contacts.push({id:randomUUID(),at,actorId:a.actorId,actorName:a.actorName,weaponType:a.stats.weaponType,kind:'hit',damage:budget,crit:false,fx:'hit'});
        const total=result.cumulative;
        candidate.normalLive.actors[a.actorId]={...candidate.normalLive.actors[a.actorId],hp:result.finalPlayerHp,maxHp:result.playerMaxHp||a.maxHp,lastAt:at,result:structuredClone(total),recoverAt:result.finalPlayerHp<=0?at+30000:0,active:result.finalPlayerHp>0&&candidate.currentHp>0};
        if(result.finalPlayerHp<=0)candidate.normalLiveDeath={...candidate.normalLiveDeath,[a.actorId]:{recoverAt:at+30000,name:a.actorName,maxHp:a.maxHp}};
        if (zone === controls.ZONE && !enemy) controls.add(candidate, a, result, at);
        steps.push({a,result,beforeHp});
      }
      applyMonsterHp(candidate,room,clock);
      if (zone === hutaoEntry.ZONE) candidate.worldBossPartsHp = { body: candidate.currentHp };
      const npcChanged=advanceCompanions(room,candidate,{at,enemy,enemyHp:state.currentHp,contacts,health,clock});
      if(!steps.length&&!npcChanged&&!companionsChanged){if(enemy)room.enemyAt=room.epoch+(Math.floor((at-room.epoch)/room.enemyTick)+1)*room.enemyTick;return;}
      applyMonsterHp(candidate,room,clock);
      for(const {a,result} of steps)candidate.normalLive.actors[a.actorId].active=result.finalPlayerHp>0&&candidate.currentHp>0;
      saveMonsterClock(candidate,clock);
      // HP, damage credit and the recovery snapshot commit in the same CAS. No
      // public packet, reward or second attack precedes this successful write.
      if(candidate.currentHp<=0)for(const saved of Object.values(candidate.normalLive.actors))saved.active=false;
      const saved=await room.sc.monsterService.saveStateIfActiveMonster(candidate,zone,room.seq,state.currentHp);
      if(!saved){this.failRoom(room,new Error("共鬥狀態已被更新，本次未提交出手已停止"));return;}
      await riichi.flush(room.sc, candidate);
      if (zone !== hutaoEntry.ZONE) riichi.apply(room, candidate, at);
      if (zone === hutaoEntry.ZONE) {
        bossRiichi.applyTicks(room, candidate, at);
        if (clock.hutaoBossRiichi) contacts.push({ id: clock.hutaoBossRiichi.id, at, actorId: "hutao-boss", actorName: room.monster.name, kind: "hit", damage: 0, fx: "boss-riichi-" + clock.hutaoBossRiichi.outcome, crit: false });
      }
      for (const [id, pulse] of room.riichiPulses) if (pulse.tsumo) contacts.push({ id: randomUUID(), at, actorId: id, actorName: room.members.get(id).actorName, kind: "hit", damage: 0, fx: "tsumo", crit: false });
      for(const{a,result}of steps){a.lastAt=at;a.hp=result.finalPlayerHp;a.maxHp=result.playerMaxHp||a.maxHp;a.recoverAt=candidate.normalLive.actors[a.actorId].recoverAt;a.result=result.cumulative;a.logs.push(...result.roundLogs);a.dice.push(...result.diceEvents);if(!enemy&&a.attackAt<=at){a.attacks++;a.attackAt=at+a.tick;}const packet={id:a.id,zone,actionSeq:++a.actionSeq,kind:enemy?'monster':'player',attackCount:a.attacks,logs:result.roundLogs,diceEvents:result.diceEvents,hp:a.hp,monsterHp:candidate.currentHp,at};a.logPackets=[...a.logPackets.slice(-299),packet];this.emit(a.actorId,{type:'normal_live_action',data:packet});}
      if(enemy){for(const {a}of steps)a.enemyTurns=(a.enemyTurns||0)+1;room.enemyTurn++;room.enemyAt=room.epoch+(Math.floor((at-room.epoch)/room.enemyTick)+1)*room.enemyTick;}
      this.updateScene(room,candidate,contacts,health);
      if(candidate.currentHp<=0){
        // The committed hit must be visible before any reward I/O. Slow awards
        // cannot hold HP above zero or move this contact to a later timestamp.
        room.deathAt=this.scene.scenes.get(zone)?.deathAt||this.now();
        await this.settleKill(room,candidate);return;
      }
      if (zone !== hutaoEntry.ZONE) for(const{a}of steps)if(a.hp<=0)this.finishActor(room,a,candidate,"lose");
      if (zone === hutaoEntry.ZONE && [...room.members.values()].every(a=>a.done||a.hp<=0)) this.finishRoom(room,candidate,"lose");
      if(!room.companions.length&&[...room.members.values()].every(a=>a.done))this.close(room);
    });
  }
  updateScene(room,state,contacts,health) {
    const s=this.scene.ensure(room.zone,state,room.monster);if(!s)return;
    s.mode="live";s.liveHp=Number(state.currentHp);s.maxHp=normalMaxHp(state,room.monster);s.baseHp=s.liveHp;s.settledHp=s.liveHp;
    if (room.zone === controls.ZONE) s.controlGauges = structuredClone(state.liveControlGauges);
    if (room.zone === hutaoEntry.ZONE) s.hutaoWind = require("../../shared/hutaoEvent").windAt(this.now());
    const presentedAt=this.now();
    contacts=contacts.map(c=>({...c,at:presentedAt}));
    health=health.map(e=>({...e,at:presentedAt}));
    const replaced=new Set(contacts.map(c=>c.id));
    s.events=[...s.events.filter(e=>!replaced.has(e.id)),...contacts].filter(e=>e.at>=this.now()-1500).slice(-512);
    if(s.liveHp<=0&&!s.deathAt){s.deathAt=this.now();s.advanceAt=s.deathAt+650;s.transitionPending=true;}
    for(const a of room.members.values()){
      if(a.done&&this.vitals.get(a.actorId)?.id!==a.id)continue;
      this.vitals.set(a.actorId,{id:a.id,zone:room.zone,at:this.now(),actorId:a.actorId,name:a.actorName,avatarUrl:require('./avatarCache').get(a.actorId)||null,maxHp:a.maxHp,baseHp:a.hp,events:[...(this.vitals.get(a.actorId)?.id===a.id?this.vitals.get(a.actorId).events:[]),...health.filter(e=>e.actorId===a.actorId)].filter(e=>presentedAt-e.at<1500).slice(-32).map(e=>({...e,hp:a.hp})),active:!a.done&&a.hp>0,recoverAt:room.zone===hutaoEntry.ZONE&&!a.done?0:a.recoverAt||0,riichi:a.riichi,retreated:Boolean(a.retreated)});
    }
    room.npcScene=companionSnapshot(room,state,this.now(),health);
    room.npcWakeAt=Math.min(...Object.values(state.normalLive?.npcs||{}).flatMap(n=>n.selected&&n.hp>0?[n.attackAt]:n.hp<=0&&n.recoverAt>this.now()?[n.recoverAt]:[]));
    s.liveActors=this.actorSnapshot(room.zone);
    s.revision=++this.scene.revision;this.scene.publish(s);
  }
  finishActor(room,a,state,outcome) {
    if(a.done)return;a.done=true;this.players.delete(a.actorId);a.recoverAt=a.recoverAt||(a.hp<=0?this.now()+30000:0);const v=this.vitals.get(a.actorId);if(v){v.active=false;v.recoverAt=a.recoverAt;v.retreated=Boolean(a.retreated);}
    const result={...(a.result||{}),outcome,roundLogs:a.logs,diceEvents:a.dice,finalPlayerHp:a.hp,finalMonsterHp:Number(state.currentHp)||0,liveBattleId:a.id,liveRetreated:Boolean(a.retreated),liveEndedAt:outcome==="win"?(room.deathAt||a.lastAt||this.now()):(a.lastAt||this.now()),liveInitial:a.initial,liveSettledState:state,liveRewards:a.rewards,liveLogPackets:a.logPackets,totalDamage:Number(a.result?.totalDamage)||0};
    a.resolve(result);
  }
  finishRoom(room,state,outcome) {for(const a of room.members.values())if(!a.done)this.finishActor(room,a,state,a.hp<=0?"lose":outcome);this.close(room);}
  close(room){room.closed=true;if(room.timer)clearInterval(room.timer);room.timer=null;}
  failRoom(room,error){for(const a of room.members.values())if(!a.done){a.done=true;this.players.delete(a.actorId);this.complete(a.actorId,{...a.initial,livePending:false,outcome:'interrupted',finalPlayerHp:a.hp,logs:a.logs,rewardLines:['戰鬥暫停；已提交的傷害保留，請重新出戰。']});a.reject(error);}this.close(room);}
  async settleKill(room,state){
    this.close(room);
    room.encounterId=this.scene.scenes.get(room.zone)?.encounterId;
    const detached=require('./normalLiveSettlement');
    const job=await detached.capture(room.sc,room,state);
    if(job){
      for(const a of room.members.values()){
        a.rewards=[`勝利｜${room.monster.name}`,"獎勵入帳中"];
        a.initial.liveRewardsPending=true;
      }
      // Resolve durable combat resources now; rewards neither own the zone queue
      // nor prevent the same player joining the successor after the handoff.
      this.finishRoom(room,state,"win");
      detached.settle(room.sc,job,rewards=>this.presentSettlementRewards(job,rewards)).catch(error=>console.error('[DetachedLiveRewards]',job.key,error.message));
      return;
    }
    const first=[...room.members.values()].find(a=>!a.done)||[...room.members.values()][0];
    const presentDrops=(rewards)=>{
      if(room.dropsPresented)return;room.dropsPresented=true;
      const scene=this.scene.scenes.get(room.zone);
      if(scene)scene.rewardsReadyAt=this.now();
      for(const a of room.members.values()) {
        const drops=rewards?.[a.actorId]?.dropEntries||[];
        a.initial.liveDrops={id:a.id,zone:room.zone,encounterId:this.scene.scenes.get(room.zone)?.encounterId,deathAt:room.deathAt,drops};
        this.emit(a.actorId,{type:'normal_live_drops',data:a.initial.liveDrops});
      }
    };
    const lines=await require('../battle/monsterKillSettlement').handleMonsterKill({serviceContext:room.sc,zoneKey:room.zone,monster:room.monster,state,discordId:first?.actorId||null,displayName:first?.actorName||null,session:{monsterName:room.monster.name},totalDamage:0,onRewardsReady:presentDrops});
    presentDrops(lines._perPidRewards);
    const scene=this.scene.scenes.get(room.zone);
    if(scene?.transitionPending&&!scene.next){
      scene.transitionPending=false;scene.advanceAt=scene.advanceAt||scene.deathAt+650;
      scene.revision=++this.scene.revision;this.scene.publish(scene);
    }
    for(const a of room.members.values()){
      const reward=lines._perPidRewards?.[a.actorId]||{gold:0,exp:0,drops:[]};
      const own=[`勝利｜${room.monster.name}`,`金幣 +${reward.gold||0}、EXP +${reward.exp||0}`];own._summary=reward;own._drops=reward.dropEntries||[];a.rewards=own;
    }
    this.finishRoom(room,state,"win");
  }
  presentSettlementRewards(job,rewards){
    const scene=this.scene.scenes.get(job.zone);
    if(scene?.encounterId===job.encounterId)scene.rewardsReadyAt=this.now();
    for(const [pid,a]of Object.entries(job.state.normalLive.actors||{})){
      const reward=rewards?.[pid]||{gold:0,exp:0,drops:[]};
      const rewardLines=[`勝利｜${job.monster.name}`,`金幣 +${reward.gold||0}、EXP +${reward.exp||0}`];
      const packet={rewardLines,rewardSummary:reward,drops:reward.dropEntries||[],liveRewardsPending:false};
      this.rewardReports.set(a.id,packet);
      if(this.rewardReports.size>200)this.rewardReports.delete(this.rewardReports.keys().next().value);
      const drop={id:a.id,zone:job.zone,encounterId:job.encounterId,deathAt:job.deathAt,drops:packet.drops};
      const latest=this.results.get(pid);
      if(latest?.payload.liveBattleId===a.id)latest.payload={...latest.payload,...packet,liveDrops:drop,liveReport:latest.payload.liveReport?{...latest.payload.liveReport,...packet}:latest.payload.liveReport};
      this.emit(pid,{type:'normal_live_drops',data:drop});
      // This updates only the old battle record; no cooldown or lifecycle replay.
      this.emit(pid,{type:'normal_live_result',data:{zone:job.zone,liveBattleId:a.id,reportOnly:true,outcome:a.hp<=0?'lose':'win',playerName:a.name,playerMaxHp:a.maxHp,finalPlayerHp:a.hp,monsterName:job.monster.name,monsterMaxHp:normalMaxHp(job.state,job.monster),finalMonsterHp:0,totalDamage:job.state.damageMap?.[pid]?.damage||0,...this.reports.get(a.id),...packet}});
    }
  }
  actorSnapshot(zone){const out=[];for(const[id,a]of this.vitals){if(this.now()-a.at>180000){this.vitals.delete(id);continue;}if(a.zone===zone)out.push({...a,baseHp:a.recoverAt&&a.recoverAt<=this.now()?a.maxHp:a.baseHp,events:a.events.filter(e=>this.now()-e.at<1500)});}const room=this.zones.get(zone);if(room)out.push(...(room.npcScene||[]).filter(a=>!room.closed||(!a.active&&a.recoverAt>this.now())).map(a=>({...a,events:a.events.filter(e=>this.now()-e.at<1500)})));return out;}
  status(actorId){const a=this.players.get(String(actorId));if(a?.joining)return null;if(a)return{...a.initial,logs:a.logs,liveLogPackets:a.logPackets,finalPlayerHp:a.hp,lastAt:a.lastAt||0,finalMonsterHp:this.scene.scenes.get(a.initial.zone)?.liveHp,sharedScene:this.scene.publicSnapshot(this.scene.scenes.get(a.initial.zone))};const result=this.results.get(String(actorId)),v=this.vitals.get(String(actorId));if(v?.retreated&&v.recoverAt>this.now())return{...(result?.payload||{}),zone:v.zone,liveBattleId:v.id,livePending:false,liveRetreated:true,...this.leaveStatus(actorId,v.id)};return result&&this.now()-result.at<120000?{...result.payload,...(result.payload.liveReportPending?{cooldownMs:Math.max(0,Number(result.payload.nextBattleAt||0)-this.now())}:{})}:null;}
  markReady(actorId,payload){
    const data={...payload,...this.rewardReports.get(payload.liveBattleId),livePending:false,liveReportPending:true};
    this.results.set(String(actorId),{at:this.now(),payload:data});
    this.emit(String(actorId),{type:'normal_live_ready',data});
  }
  complete(actorId,payload){payload={...payload,...this.rewardReports.get(payload.liveBattleId)};this.reports.set(payload.liveBattleId,payload);if(this.reports.size>200)this.reports.delete(this.reports.keys().next().value);if(payload.liveRetreated)payload={...payload,...this.leaveStatus(actorId,payload.liveBattleId)};const latest=this.results.get(String(actorId));
    // A report may finish after another battle starts. Never replace its reconnect state.
    const active=this.players.get(String(actorId));
    if((!active||active.id===payload.liveBattleId)&&(!latest||latest.payload.liveBattleId===payload.liveBattleId))this.results.set(String(actorId),{at:this.now(),payload:latest?.payload.liveReportPending?{...latest.payload,liveReport:payload}:payload});
    this.emit(String(actorId),{type:'normal_live_result',data:payload});}
}
const normalLiveCombat=new NormalLiveCombat();
module.exports={NormalLiveCombat,normalLiveCombat};
