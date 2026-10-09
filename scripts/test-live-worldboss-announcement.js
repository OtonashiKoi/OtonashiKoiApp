"use strict";
const assert = require("node:assert/strict");
const { NormalLiveCombat } = require("../src/services/realtime/normalLiveCombat");
const { ZoneCombatScene } = require("../src/services/realtime/zoneCombatScene");
const entry = require("../src/services/realtime/hutaoLiveEntry");
const announcement = require("../src/services/realtime/liveWorldBossAnnouncement");
const runtime = require("../src/bot/runtimeContext");
const { ZONE_BY_KEY } = require("../src/shared/zones");
const zone = entry.ZONE;
const stats={atk:100,maxHp:10000,str:0,agi:1,vit:0,int:0,dex:100,luk:0,level:65,hit:100,dodge:0,crit:0,combo:0,def:0,flatDef:0,dmgMin:1,dmgMax:1};
function fixture(){
 let now=1000,state={activeMonsterSeq:1,normalLiveSpawnAt:1000,currentHp:1000000,damageMap:{},participants:[]},fail=false,failProgress=false,writeCount=0;
 const progress=new Map(),gold=new Map(),operations=new Map(),monster={id:'hutao-fixture',seq:1,name:'胡桃',zone,isBoss:true,calc:{...stats,atk:30,maxHp:1000000}};
 const sc={progressRepository:{findByPlayerId:async id=>structuredClone(progress.get(id)),updateFields:async(id,fields)=>{writeCount++;Object.assign(progress.get(id),structuredClone(fields));},saveIfUnchanged:async(next,expected)=>{if(failProgress||progress.get(next.playerId).updatedAt!==expected)return false;progress.set(next.playerId,structuredClone(next));return true;}},
 monsterService:{getState:async()=>structuredClone(state),listMonsters:async()=>[monster],saveStateIfActiveMonster:async(next,z,seq,hp)=>{if(fail||state.activeMonsterSeq!==seq||state.currentHp!==hp)return false;state=structuredClone(next);return true;}},
 rewardService:{grantCurrency:async input=>{const previous=operations.get(input.sourceRef);if(previous){if(previous.error)throw previous.error;return previous;}
 if((gold.get(input.discordId)||0)+input.amount<0){const error=Object.assign(Error('gold insufficient'),{code:'INSUFFICIENT_BALANCE'});operations.set(input.sourceRef,{error});throw error;}
 gold.set(input.discordId,(gold.get(input.discordId)||0)+input.amount);operations.set(input.sourceRef,input);return input;}}};
 const scene=new ZoneCombatScene({now:()=>now,emit:()=>{}}),engine=new NormalLiveCombat({now:()=>now,auto:false,starterNpcs:false,scene,emit:()=>{}});
 function add(id,extra={}){progress.set(id,{playerId:id,activeCharacterSlot:1,seasonKey:'test',inventory:[],updatedAt:'0',...extra});gold.set(id,100000);}
 async function join(id,card=false,extra={}){const promise=engine.join({sc,zone,monster,actorId:id,actorName:id,stats:{...stats,...extra},monsterStats:monster.calc,options:{playerName:id,playerLevel:65,equipped:card?{special_1:{monsterCardSkill:{key:'hutao_riichi'}}}:{}}});promise.catch(()=>{});await engine.queues.get(zone);return {promise,actor:engine.players.get(id)};}
 return {sc,engine,scene,add,join,progress,gold,operations,state:()=>state,time:n=>now=n,now:()=>now,setState:s=>state=structuredClone(s),fail:v=>fail=v,failProgress:v=>failProgress=v,writes:()=>writeCount,close:()=>{const r=engine.zones.get(zone);if(r&&!r.closed)engine.failRoom(r,Error('fixture completed'));}};
}

const messages=[], web=[];
const client={isReady:()=>true,channels:{fetch:async id=>{assert.equal(id,"1498608950671839263");return {isTextBased:()=>true,send:async data=>{messages.push(data);}};}}};
const previousClient=runtime.getBotClient;
runtime.getBotClient=()=>client;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){const f=fixture();f.sc._broadcastWorldBossStart=(...args)=>web.push(args);return f;}
async function check(name,fn){await fn();console.log("PASS",name);}
(async()=>{
await check("successful concurrent admissions broadcast once after persisted payment/admission",async()=>{
 const f=setup();f.add('A');f.add('B');f.sc._broadcastWorldBossStart=(...args)=>{assert.equal(f.gold.get('A'),50000);assert.ok(f.state().normalLive.actors.A);assert.ok(f.state().normalLive.worldBossStartAnnouncement);web.push(args);};
 await Promise.all([f.join('A'),f.join('B')]);await flush();assert.equal(messages.length,1);assert.deepEqual(web,[['胡桃','A','A']]);
 await assert.rejects(f.engine.join({sc:f.sc,zone,actorId:'A'}),/即時戰鬥/);await flush();assert.equal(messages.length,1);f.close();
});
await check("recreated runtime and persisted encounter do not rebroadcast; respawn broadcasts again",async()=>{
 const f=setup();f.add('A');await f.join('A');await flush();const n=messages.length;f.close();
 const e=new NormalLiveCombat({auto:false,starterNpcs:false,scene:new ZoneCombatScene({emit:()=>{}}),emit:()=>{}});
 f.add('B');let p=e.join({sc:f.sc,zone,monster:{seq:1,isBoss:true,name:'胡桃',calc:stats},actorId:'B',actorName:'B',stats,monsterStats:stats,options:{equipped:{}}});p.catch(()=>{});await e.queues.get(zone);await flush();assert.equal(messages.length,n);e.failRoom(e.zones.get(zone),Error('end'));
 f.state().killCount=1;f.state().normalLiveSpawnAt=2000;f.add('C');await f.join('C');await flush();assert.equal(messages.length,n+1);f.close();
});
await check("insufficient gold and failed admission CAS neither mark nor broadcast; successful retry does",async()=>{
 const f=setup(),n=messages.length;f.add('A');f.gold.set('A',49999);await assert.rejects(f.join('A'),/insufficient/);await flush();assert.equal(messages.length,n);assert.equal(f.state().normalLive,undefined);
 f.add('B');f.fail(true);await assert.rejects(f.join('B'));await flush();assert.equal(f.gold.get('B'),100000);assert.equal(messages.length,n);assert.equal(f.state().normalLive,undefined);
 f.fail(false);await f.join('B');await flush();assert.equal(messages.length,n+1);f.close();
});
await check("private preview suppresses announcement; ordinary monsters do not claim one",async()=>{
 const previous=ZONE_BY_KEY[zone].previewPlayerIds;ZONE_BY_KEY[zone].previewPlayerIds=['A'];const f=setup(),n=messages.length;
 try{f.add('A');await f.join('A');await flush();assert.equal(messages.length,n);assert.equal(f.state().normalLive.worldBossStartAnnouncement,undefined);}finally{ZONE_BY_KEY[zone].previewPlayerIds=previous;f.close();}
 assert.equal(announcement.claim({normalLive:{}},'normal',{isBoss:true,name:'boss'},'A','A',1),null);
});
await check("Discord alarm tags only configured role; announcement has no obsolete 30-minute rule",async()=>{
 await announcement.deliver({_broadcastWorldBossStart:()=>{}},{monsterName:'胡桃',starterName:'A',starterId:'A'},{client,alarmRoleId:'123'});
 const m=messages.at(-1);assert.match(m.content,/<@&123>/);assert.deepEqual(m.allowedMentions,{roles:['123']});assert.doesNotMatch(m.content,/30 分鐘/);
 await announcement.deliver({}, {monsterName:'胡桃'}, {client,alarmRoleId:null});assert.deepEqual(messages.at(-1).allowedMentions,{parse:[]});
});
await check("Discord outage cannot reject paid admission; web still receives notification",async()=>{
 const old=runtime.getBotClient;runtime.getBotClient=()=>({isReady:()=>true,channels:{fetch:async()=>{throw Error('simulated Discord outage');}}});
 const f=setup(),n=web.length;try{f.add('A');await f.join('A');await flush();assert.ok(f.engine.players.get('A').initial.livePending);assert.equal(f.gold.get('A'),50000);assert.equal(web.length,n+1);}finally{runtime.getBotClient=old;f.close();}
});
console.log("6 live world boss announcement checks passed; no live data or messages sent");
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{runtime.getBotClient=previousClient;});
