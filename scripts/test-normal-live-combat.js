"use strict";
const assert=require('node:assert/strict');
const {NormalLiveCombat}=require('../src/services/realtime/normalLiveCombat');
const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
const {calculateBattleTickMs}=require('../src/shared/battleTiming');
const kill=require('../src/services/battle/monsterKillSettlement');
const originalKill=kill.handleMonsterKill;let kills=0;
kill.handleMonsterKill=async({state})=>{kills++;const lines=[];lines._perPidRewards=Object.fromEntries(state.participants.map(id=>[id,{gold:10,exp:20,drops:[]}]));return lines;};
const stats={atk:5,maxHp:10000,agi:1,dex:20,level:1,int:0,def:0,flatDef:0,hit:100,dodge:0,crit:0,dmgMin:1,dmgMax:1};
function fixture(count=1,hp=100000){
  let now=1000,state={activeMonsterSeq:1,normalLiveSpawnAt:100,currentHp:hp,encounterCount:count,encounterMonsterSeq:1,damageMap:{},participants:[]},fail=false;
  const monster={id:'live-test',seq:1,name:'測試怪',zone:'normal',calc:{...stats,atk:30,maxHp:hp/count}},packets=[];
  const sc={monsterService:{getState:async()=>structuredClone(state),saveStateIfActiveMonster:async(next,z,seq,expected)=>{if(fail||state.activeMonsterSeq!==seq||state.currentHp!==expected)return false;state=structuredClone(next);return true;}}};
  const scene=new ZoneCombatScene({now:()=>now,emit:()=>{}}),engine=new NormalLiveCombat({now:()=>now,scene,emit:(id,data)=>packets.push({id,...data}),auto:false,starterNpcs:false});
 const join=(id,extra={},extraOptions={},zone='normal')=>engine.join({sc,zone,monster,state,actorId:id,actorName:id,stats:{...stats,...extra},monsterStats:monster.calc,options:{playerName:id,playerLevel:1,equipped:{},inventory:[],encounterCount:count,encounterUnitHp:hp/count,...extraOptions}});
  return{engine,scene,join,packets,state:()=>state,time:value=>{now=value;},enemyAt:turn=>state.normalLiveSpawnAt+turn*calculateBattleTickMs(monster.calc.agi),fail:()=>{fail=true;},respawn:hp=>{state={...state,currentHp:hp,killCount:{respawns:1},damageMap:{},participants:[]};}};
}
const oldRandom=Math.random;Math.random=()=>0.5;
const checks=[];
async function check(name,work){try{await work();checks.push({name,ok:true});console.log('PASS',name);}catch(e){checks.push({name,ok:false,error:e.stack});console.error('FAIL',name,e.message);}}
(async()=>{
await check('leaving before first strike persists inactivity without damage or kill rewards; retries are idempotent',async()=>{
 const f=fixture(),p=f.join('A');await f.engine.queues.get('normal');const id=f.engine.status('A').liveBattleId,before=kills;
 assert.deepEqual(await f.engine.leave('A',id),{left:true,liveBattleId:id,recoveryUntil:32500,cooldownMs:31500});const result=await p;
 assert.equal(result.liveRetreated,true);assert.equal(result.outcome,'timeout');assert.equal(result.totalDamage,0);
 assert.equal(f.state().normalLive.actors.A.active,false);assert.equal(f.state().currentHp,100000);assert.equal(kills,before);
 assert.equal(f.scene.publicSnapshot(f.scene.scenes.get('normal')).actors.find(a=>a.actorId==='A').active,false);
 assert.deepEqual(await f.engine.leave('A',id),{left:false,recoveryUntil:32500,cooldownMs:31500});f.time(1300);await f.engine.advance('normal');assert.equal(f.state().currentHp,100000);
 assert.equal(f.state().normalLiveDeath.A.kind,'retreat');assert.equal(f.state().normalLiveDeath.A.hp,10000);assert.equal(f.state().normalLive.actors.A.recoverAt,32500);
 await assert.rejects(f.join('A'),/恢復中/);await assert.rejects(f.join('A',{}, {},'mid'),/恢復中/);
 f.time(32499);await assert.rejects(f.join('A'),/恢復中/);f.time(32500);const next=f.join('A');await f.engine.queues.get('normal');assert.equal(f.engine.players.get('A').hp,10000);f.engine.failRoom(f.engine.zones.get('normal'),Error('end cooldown fixture'));await assert.rejects(next);
});
await check('leaving stops only the matching actor; retains submitted damage and ends their party aura',async()=>{
 const f=fixture(),a=f.join('A'),h=f.join('H',{}, {partyEffects:[{key:'party_damage_up',params:{value:50},sourceDiscordId:'H',isSelfAura:true}]});
 await f.engine.queues.get('normal');const aid=f.engine.status('A').liveBattleId,hid=f.engine.status('H').liveBattleId;
 assert.deepEqual(await f.engine.leave('A',hid),{left:false});assert.ok(f.engine.players.has('A')&&f.engine.players.has('H'));
 f.time(1300);await f.engine.advance('normal');const credit=structuredClone(f.state().damageMap.H);
 await f.engine.leave('H',hid);await h;assert.ok(f.engine.players.has('A'));
 assert.equal(f.engine.partyEffects(f.engine.zones.get('normal'),f.engine.players.get('A'),f.state()).length,0);
 f.time(3700);await f.engine.advance('normal');assert.deepEqual(f.state().damageMap.H,credit);assert.ok(f.state().damageMap.A.damage>0);
 assert.equal(f.engine.recoveryUntil('H'),32800,'teammate attacks cannot erase the withdrawn actor cooldown');
 const repeat=await f.engine.leave('H',hid);assert.equal(repeat.recoveryUntil,32800);assert.equal(repeat.cooldownMs,29100);
 assert.equal(f.engine.status('H').cooldownMs,29100,'reconnect resumes remaining cooldown');
 await f.engine.leave('A',aid);await a;assert.equal(f.engine.zones.get('normal').closed,true);
 f.time(35200);
 const next=f.join('A');await f.engine.queues.get('normal');const nextId=f.engine.status('A').liveBattleId;
 assert.notEqual(nextId,aid);assert.deepEqual(await f.engine.leave('A',aid),{left:false});assert.equal(f.engine.status('A').liveBattleId,nextId);
 await f.engine.leave('A',nextId);await next;
});
await check('failed leave persistence keeps the actor active and does not resolve the combat',async()=>{
 const f=fixture(),p=f.join('A');await f.engine.queues.get('normal');const id=f.engine.status('A').liveBattleId;f.fail();
 await assert.rejects(f.engine.leave('A',id),/脫離戰鬥尚未成功/);
 assert.ok(f.engine.players.has('A'));assert.equal(f.state().normalLive.actors.A.active,true);
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await assert.rejects(p);
});
await check('lethal hit and death publish before slow awards; durable loot precedes slow final report without moving hit time',async()=>{
 const prior=kill.handleMonsterKill;let entered,ready,grant,release;
 const started=new Promise(r=>entered=r),receipt=new Promise(r=>ready=r),awards=new Promise(r=>grant=r),tail=new Promise(r=>release=r);
 kill.handleMonsterKill=async(args)=>{entered();await awards;const perPidRewards={A:{gold:10,exp:20,drops:['測試掉落'],dropEntries:[{uuid:'loot-one',name:'測試掉落'}]}};args.onRewardsReady(perPidRewards);args.onRewardsReady(perPidRewards);ready();await tail;const lines=[];lines._perPidRewards=perPidRewards;return lines;};
 try {
  const f=fixture(1,1),p=f.join('A',{atk:10000});await f.engine.queues.get('normal');f.time(1300);const step=f.engine.advance('normal');await started;
  const dead=f.scene.publicSnapshot(f.scene.scenes.get('normal'));
  assert.equal(dead.liveHp,0,'visible HP zero never waits for slow inventory writes');
  assert.equal(dead.deathAt,1300);assert.ok(dead.events.some(e=>e.at===1300&&e.damage>0),'final hit retains its real clock');
  assert.equal(f.packets.filter(e=>e.type==='normal_live_drops').length,0,'pending loot is not fabricated');
  assert.equal(f.scene.scenes.get('normal').advanceAt,1950,'departure is scheduled before reward I/O completes');
  f.time(4300);grant();await receipt;
  const action=f.packets.find(e=>e.type==='normal_live_action'),drop=f.packets.find(e=>e.type==='normal_live_drops');
  assert.equal(action.data.kind,'player');assert.equal(action.data.actionSeq,1);assert.equal(action.data.attackCount,1);
  assert.equal(drop.data.drops[0].uuid,'loot-one');assert.equal(drop.data.deathAt,f.scene.scenes.get('normal').deathAt);
  assert.equal(f.scene.scenes.get('normal').deathAt,1300,'slow awards never restart or postpone death');
  assert.equal(f.packets.filter(e=>e.type==='normal_live_drops').length,1,'duplicate reward callbacks do not duplicate loot');
  assert.ok(f.engine.players.has('A'),'drop receipt precedes slow full result');
  release();await step;const result=await p;assert.equal(result.liveEndedAt,1300);assert.equal(result.liveLogPackets.length,1);
 } finally {grant?.();release?.();kill.handleMonsterKill=prior;}
});
await check('health presentation starts after durable commit and survives the next player action',async()=>{
 const f=fixture(),p=f.join('A');p.catch(()=>{});await f.engine.queues.get('normal');
 const room=f.engine.zones.get('normal');room.members.get('A').attackAt=100000;
 const save=room.sc.monsterService.saveStateIfActiveMonster;
 room.sc.monsterService.saveStateIfActiveMonster=async(...args)=>{const ok=await save(...args);f.time(3000);return ok;};
 f.time(f.enemyAt(1));await f.engine.advance('normal');
 const actor=f.engine.actorSnapshot('normal').find(a=>a.actorId==='A');
 assert(actor.events.some(e=>e.kind==='hit'));assert(actor.events.every(e=>e.at===3000),'I/O latency must not expire feedback before publishing');
 const hit=actor.events.find(e=>e.kind==='hit').id;
 room.sc.monsterService.saveStateIfActiveMonster=save;room.members.get('A').attackAt=3100;room.enemyAt=100000;
 f.time(3100);await f.engine.advance('normal');
 assert(f.engine.actorSnapshot('normal').find(a=>a.actorId==='A').events.some(e=>e.id===hit),'next player action retains recent received hit');
 f.engine.failRoom(room,Error('fixture end'));await assert.rejects(p);
});
await check('50 simultaneous windups publish one complete snapshot; attacks keep their real clock',async()=>{
 const f=fixture(3),pending=[];
 for(let i=0;i<50;i++){const p=f.join('crowd'+i);p.catch(()=>{});pending.push(p);}
 await f.engine.queues.get('normal');
 const publish=f.scene.publish.bind(f.scene);let publishes=0;
 f.scene.publish=scene=>{publishes++;return publish(scene);};
 f.time(1180);await f.engine.advance('normal');
 assert.equal(publishes,1,'one pulse must not broadcast 50 increasingly large whole-scene snapshots');
 const cues=f.scene.publicSnapshot(f.scene.scenes.get('normal')).events;
 assert.equal(cues.length,50);assert.equal(new Set(cues.map(c=>c.id)).size,50);
 assert.ok(cues.every(c=>c.at===1300&&c.damage===0),'retain each actor and scheduled attack time');
 assert.equal(f.state().currentHp,100000);assert.equal(f.packets.filter(p=>p.type==='normal_live_action').length,0);
 f.time(1200);await f.engine.advance('normal');assert.equal(publishes,1,'do not repeat announced windups');
 f.time(1300);await f.engine.advance('normal');assert.equal(publishes,2,'all committed contacts publish together');
 const actions=f.packets.filter(p=>p.type==='normal_live_action');assert.equal(actions.length,50);assert.ok(actions.every(p=>p.data.at===1300&&p.data.attackCount===1),'private combat log remains immediate per actor');
 assert.ok(f.state().currentHp<f.state().coopMaxHp);
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end crowd fixture'));await Promise.allSettled(pending);
});
await check('before clock: no damage, no RNG result or reward; duplicate join rejected',async()=>{
  const f=fixture(),p=f.join('A');p.catch(()=>{});await f.engine.queues.get('normal');assert.equal(f.state().currentHp,100000);assert.equal(f.state().normalLive.actors.A.result,undefined);const before=kills;await assert.rejects(f.join('A'),/已在/);assert.equal(kills,before);f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await assert.rejects(p);
});
await check('restored live attack cadence: AGI 1 every 1500 ms, AGI 40 and 60 every 500 ms',async()=>{
 const f=fixture(),pending=[f.join('A'),f.join('B',{agi:40}),f.join('C',{agi:60})];pending.forEach(p=>p.catch(()=>{}));await f.engine.queues.get('normal');
 const attacks=id=>f.engine.players.get(id).attacks;
 f.time(1300);await f.engine.advance('normal');assert.deepEqual(['A','B','C'].map(attacks),[1,1,1]);
 f.time(f.enemyAt(1));await f.engine.advance('normal');
 f.time(1799);await f.engine.advance('normal');assert.deepEqual(['A','B','C'].map(attacks),[1,1,1]);
 f.time(1800);await f.engine.advance('normal');assert.deepEqual(['A','B','C'].map(attacks),[1,2,2]);
 f.time(2300);await f.engine.advance('normal');assert.deepEqual(['A','B','C'].map(attacks),[1,3,3]);
 f.time(2799);await f.engine.advance('normal');assert.equal(attacks('A'),1);
 f.time(2800);await f.engine.advance('normal');assert.deepEqual(['A','B','C'].map(attacks),[2,4,4]);
 assert.ok(['A','B','C'].every(id=>f.state().damageMap[id].damage>0));
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end cadence fixture'));await Promise.allSettled(pending);
});
await check('common enemy pulse targets different-AGI actors at same time; actual persisted HP matches scene',async()=>{
  const f=fixture(3),a=f.join('A'),b=f.join('B',{agi:5});a.catch(()=>{});b.catch(()=>{});await f.engine.queues.get('normal');f.time(1300);await f.engine.advance('normal');assert.ok(f.state().currentHp<f.state().coopMaxHp);const before=f.state().currentHp;f.time(2500);await f.engine.advance('normal');const events=f.packets.filter(p=>p.type==='normal_live_action'&&p.data.at===2500);assert.equal(events.length,2);assert.ok(events.every(e=>e.data.hp<10000));const actors=f.scene.publicSnapshot(f.scene.scenes.get('normal')).actors;assert.equal(actors.find(a=>a.actorId==='A').baseHp,f.state().normalLive.actors.A.hp);assert.ok(f.state().currentHp<=before);f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await Promise.allSettled([a,b]);
});
await check('enemy AGI clock is anchored to spawn; late joins and an empty room do not restart it',async()=>{
 const f=fixture(),a=f.join('A');a.catch(()=>{});await f.engine.queues.get('normal');
 const first=f.enemyAt(1);f.time(first-300);const b=f.join('B');b.catch(()=>{});await f.engine.queues.get('normal');
 assert.equal(f.engine.zones.get('normal').enemyAt,first);f.time(first-1);await f.engine.advance('normal');assert.equal(f.state().normalLive.actors.A.hp,10000);assert.equal(f.state().normalLive.actors.B.hp,10000);
 f.time(first);await f.engine.advance('normal');assert.ok(f.state().normalLive.actors.A.hp<10000&&f.state().normalLive.actors.B.hp<10000);f.engine.failRoom(f.engine.zones.get('normal'),Error('empty'));await Promise.allSettled([a,b]);
 f.time(6000);const c=f.join('C');c.catch(()=>{});await f.engine.queues.get('normal');assert.equal(f.engine.zones.get('normal').enemyAt,6100);f.engine.failRoom(f.engine.zones.get('normal'),Error('end'));await Promise.allSettled([c]);
});
await check('AGI difference 5/6/15/16 preserves first strike and alternate enemy suppression',async()=>{
  for(const [agi,skipFirst,skipThird]of [[6,false,false],[7,true,false],[16,true,false],[17,true,true]]){
    const f=fixture(),p=f.join('A',{agi});p.catch(()=>{});await f.engine.queues.get('normal');f.time(1300);await f.engine.advance('normal');const hp=f.state().normalLive.actors.A.hp;f.time(f.enemyAt(1));await f.engine.advance('normal');assert.equal(f.state().normalLive.actors.A.hp===hp,skipFirst,`agi ${agi} first`);f.time(f.enemyAt(2));await f.engine.advance('normal');const hp2=f.state().normalLive.actors.A.hp;f.time(f.enemyAt(3));await f.engine.advance('normal');assert.equal(f.state().normalLive.actors.A.hp===hp2,skipThird,`agi ${agi} third`);f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await Promise.allSettled([p]);
  }
});
await check('death immediately stops that actor; all targets still receive current pulse',async()=>{
  const f=fixture(3),a=f.join('A',{maxHp:1}),b=f.join('B');await f.engine.queues.get('normal');f.time(1300);await f.engine.advance('normal');f.time(2500);await f.engine.advance('normal');assert.equal((await a).outcome,'lose');assert.ok(f.state().normalLive.actors.B.hp<10000);const damage=f.state().damageMap.A.damage;f.time(3700);await f.engine.advance('normal');assert.equal(f.state().damageMap.A.damage,damage);assert.equal(f.state().normalLive.actors.A.hp,0);f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await Promise.allSettled([b]);
});
await check('enemy death commits before one settlement; no future attacks or double rewards',async()=>{
  const f=fixture(1,5),before=kills,a=f.join('A',{atk:100}),b=f.join('B');await f.engine.queues.get('normal');assert.equal(kills,before);f.time(1300);await f.engine.advance('normal');assert.equal(f.state().currentHp,0);assert.equal(kills,before+1);const results=await Promise.all([a,b]);assert.ok(results.every(r=>r.outcome==='win'));const packets=f.packets.length;f.time(20000);await f.engine.advance('normal');assert.equal(kills,before+1);assert.equal(f.packets.length,packets);
});
await check('continuous combat exceeds 15 attacks and 120 seconds, ends only at enemy HP zero; next battle starts fresh',async()=>{
 const f=fixture(1,400),p=f.join('A');await f.engine.queues.get('normal');let activeAfter15=false,activeAfter120s=false;
 for(let i=0;i<400&&!f.engine.zones.get('normal').closed;i++){f.time(1300+i*1200);await f.engine.advance('normal');const actor=f.engine.players.get('A');if(actor?.attacks>15){activeAfter15=true;assert.equal(f.state().normalLive.actors.A.active,true);}if(i>100&&actor)activeAfter120s=true;}
 assert.ok(activeAfter15);assert.ok(activeAfter120s);assert.equal((await p).outcome,'win');assert.equal(f.state().currentHp,0);
 f.respawn(1);const next=f.join('A');await f.engine.queues.get('normal');assert.equal(f.engine.players.get('A').attacks,0);f.time(1000000);await f.engine.advance('normal');f.time(1000001);await f.engine.advance('normal');assert.equal((await next).outcome,'win');
});
await check('continuous combat can lose after attack 15 without an automatic timeout',async()=>{
 const f=fixture(),p=f.join('A',{maxHp:700});await f.engine.queues.get('normal');let exceeded=false;
 const step=calculateBattleTickMs(1)/2;
 for(let i=0;i<400&&!f.engine.zones.get('normal').closed;i++){f.time(1300+i*step);await f.engine.advance('normal');if(f.engine.players.get('A')?.attacks>15)exceeded=true;}
 assert.ok(exceeded);assert.equal((await p).outcome,'lose');assert.equal(f.state().normalLive.actors.A.hp,0);assert.ok(f.state().currentHp>0);
});
await check('idle aura ignored; late provider joins immediately; death stops aura but preserves earned assist',async()=>{
 const f=fixture(),effect={key:'party_damage_up',params:{value:50},sourceDiscordId:'H',sourceName:'H',isSelfAura:false};
 const a=f.join('A',{}, {partyEffects:[effect]});a.catch(()=>{});await f.engine.queues.get('normal');
 f.time(1300);await f.engine.advance('normal');const base=f.state().damageMap.A.damage;
 assert.equal(f.state().damageMap.H,undefined,'historic aura cannot earn reward eligibility');
 const h=f.join('H',{maxHp:1},{partyEffects:[{...effect,isSelfAura:true}]});h.catch(()=>{});await f.engine.queues.get('normal');
 f.engine.players.get('H').attackAt=100000;f.engine.players.get('A').attackAt=1400;
 f.time(1400);await f.engine.advance('normal');const boosted=f.state().damageMap.A.damage-base;
 assert.ok(boosted>base);assert.ok(f.state().damageMap.H.assist>0,'actual support is credited before final settlement');
 const credit=f.state().damageMap.H.assist;
 f.time(2500);await f.engine.advance('normal');assert.equal((await h).outcome,'lose');
 assert.equal(f.engine.partyEffects(f.engine.zones.get('normal'),f.engine.players.get('A'),f.state()).length,0);
 const before=f.state().damageMap.A.damage;f.engine.players.get('A').attackAt=2600;
 f.time(2600);await f.engine.advance('normal');assert.equal(f.state().damageMap.A.damage-before,base);
 assert.equal(f.state().damageMap.H.assist,credit,'death does not revoke prior contribution or keep generating assist');
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await Promise.allSettled([a]);
 f.respawn(100000);f.time(100000);const next=f.join('A',{}, {partyEffects:[effect]});next.catch(()=>{});await f.engine.queues.get('normal');
 f.time(100300);await f.engine.advance('normal');assert.equal(f.state().damageMap.H,undefined,'stopped provider gets no next-encounter rewards');
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await Promise.allSettled([next]);
});
await check('maximum-HP aura arrives and ends with provider; changing it preserves HP percentage without free healing',async()=>{
 const f=fixture(),a=f.join('A');a.catch(()=>{});await f.engine.queues.get('normal');f.time(1300);await f.engine.advance('normal');
 const h=f.join('H',{maxHp:1},{partyEffects:[{key:'party_max_hp_up',sourceDiscordId:'H',isSelfAura:true,params:{value:20}}]});h.catch(()=>{});await f.engine.queues.get('normal');
 f.engine.players.get('H').attackAt=100000;f.engine.players.get('A').attackAt=1400;f.time(1400);await f.engine.advance('normal');
 assert.equal(f.state().normalLive.actors.A.maxHp,12000);
 f.time(2500);await f.engine.advance('normal');await h;const pct=f.engine.players.get('A').hp/12000;
 f.engine.players.get('A').attackAt=2600;f.time(2600);await f.engine.advance('normal');assert.equal(f.state().normalLive.actors.A.maxHp,10000);
 assert.ok(Math.abs(f.engine.players.get('A').hp/10000-pct)<0.00011);
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end'));await Promise.allSettled([a]);
});
await check('real combat healing credits effective restored HP while full-HP aura earns zero assist',async()=>{
 const f=fixture(),a=f.join('A');a.catch(()=>{});await f.engine.queues.get('normal');
 const h=f.join('H',{}, {partyEffects:[{key:'party_heal',sourceDiscordId:'H',isSelfAura:true,params:{value:10}}]});h.catch(()=>{});await f.engine.queues.get('normal');
 f.time(1300);await f.engine.advance('normal');assert.equal(f.state().damageMap.H.assist||0,0);
 f.time(f.enemyAt(1));await f.engine.advance('normal');const wounded=f.engine.players.get('A').hp;
 f.time(1300+calculateBattleTickMs(1));await f.engine.advance('normal');assert.equal(f.engine.players.get('A').hp,wounded+10);
 assert.equal(f.state().damageMap.H.assist,10);
 f.engine.failRoom(f.engine.zones.get('normal'),Error('end'));await Promise.allSettled([a,h]);
});
await check('live healing and mitigation credit only actual effective support, no self or overflow credit',async()=>{
 const {creditLiveAuraAction}=require('../src/shared/liveAuraContribution');const ledger={bySource:{},bySourceJob:{}};
 const effects=[{key:'party_heal',sourceDiscordId:'H',isSelfAura:false,params:{value:10}},
 {key:'party_damage_reduction',sourceDiscordId:'S',isSelfAura:false,params:{value:20}},
 {key:'party_heal',sourceDiscordId:'A',isSelfAura:true,params:{value:20}}];
 creditLiveAuraAction(ledger,{effects,heal:0,prevented:0,damage:0});assert.deepEqual(ledger.bySource,{});
 creditLiveAuraAction(ledger,{effects,heal:7,prevented:3,damage:0});assert.deepEqual(ledger.bySource,{H:7,S:3});
 creditLiveAuraAction(ledger,{effects:[],heal:0,prevented:0,damage:100});assert.deepEqual(ledger.bySource,{H:7,S:3});
});
await check('CAS failure publishes no uncommitted damage; preserves prior state',async()=>{
  const f=fixture(),p=f.join('A');p.catch(()=>{});await f.engine.queues.get('normal');f.fail();f.time(1300);await f.engine.advance('normal');await assert.rejects(p,/未提交/);assert.equal(f.state().currentHp,100000);assert.equal(f.packets.filter(p=>p.type==='normal_live_action').length,0);
});
await check('lost HTTP/SSE does not invent extra actions; status resumes same live session',async()=>{
  const f=fixture(),p=f.join('A');p.catch(()=>{});await f.engine.queues.get('normal');const id=f.engine.status('A').liveBattleId;for(let i=0;i<20;i++)assert.equal(f.engine.status('A').liveBattleId,id);assert.equal(f.state().currentHp,100000);assert.equal(f.engine.status('other'),null);f.engine.failRoom(f.engine.zones.get('normal'),Error('end fixture'));await Promise.allSettled([p]);
});
kill.handleMonsterKill=originalKill;Math.random=oldRandom;
const fs=require('node:fs'),out=process.argv[2];if(out)fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),checks},null,2));if(checks.some(c=>!c.ok))process.exitCode=1;
})().catch(e=>{kill.handleMonsterKill=originalKill;Math.random=oldRandom;console.error(e);process.exitCode=1});
