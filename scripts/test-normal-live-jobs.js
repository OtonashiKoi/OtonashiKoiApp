"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),bson=require('bson');
const {NormalLiveCombat}=require('../src/services/realtime/normalLiveCombat');const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
const bytes=fs.readFileSync('/Users/riuchen/Documents/game-backups/realtime-combat-20261005/snapshot/items.bson'),items=[];for(let offset=0;offset<bytes.length;){const size=bytes.readInt32LE(offset);items.push(bson.deserialize(bytes.subarray(offset,offset+size)));offset+=size;}
Math.random=()=>0.5;
const settlement=require("../src/services/battle/monsterKillSettlement");settlement.handleMonsterKill=async()=>[];
(async()=>{const checks=[];for(const job of items.filter(i=>i.equipSlot==='job_eq')){
 let now=1000,state={activeMonsterSeq:1,currentHp:1e8,killCount:{},encounterCount:3,encounterMonsterSeq:1,participants:[],damageMap:{}};
 const monster={seq:1,id:'qa',name:'QA',calc:{atk:40,maxHp:1e8/3,dmgMin:1,dmgMax:1,agi:1,level:50,def:0,flatDef:0,dex:20,crit:0,hit:100,dodge:0}};
 const sc={monsterService:{getState:async()=>structuredClone(state),saveStateIfActiveMonster:async next=>{state=structuredClone(next);return true;}}};
 const engine=new NormalLiveCombat({now:()=>now,auto:false,starterNpcs:false,scene:new ZoneCombatScene({now:()=>now,emit:()=>{}}),emit:()=>{}});
 const pending=engine.join({sc,zone:'normal',monster,actorId:job.id,actorName:job.name,stats:{atk:100,dmgMin:1,dmgMax:1,maxHp:10000,agi:1,dex:100,str:100,int:100,level:50,def:0,flatDef:0,crit:0,dodge:0,hit:100},monsterStats:monster.calc,options:{equipped:{job_eq:job},inventory:[],playerLevel:50,playerName:job.name,zone:'normal',partyEffects:[],encounterCount:3,encounterUnitHp:1e8/3,shadowGaugeGrids:4,oniGaugeGrids:2,sniperGaugeGrids:2,sageGaugeGrids:2,diceGaugeGrids:2,sunSpiritHpPct:100}});pending.catch(()=>{});await engine.queues.get('normal');
 for(now=1300;now<10000;now+=400)await engine.advance('normal');
 assert.ok(state.damageMap[job.id]?.damage>0,job.name+" damage="+JSON.stringify(state.damageMap));assert.ok(Number.isFinite(state.normalLive.actors[job.id].hp));assert.ok(state.currentHp<1e8);checks.push({job:job.name,damage:state.damageMap[job.id].damage,hp:state.normalLive.actors[job.id].hp,ok:true});engine.failRoom(engine.zones.get('normal'),Error('QA end'));await Promise.allSettled([pending]);}
 const report={ok:true,checks};if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log('PASS '+checks.length+' job badges resume real combat without losing damage/HP state (includes disabled branches as regression only)');})().catch(e=>{console.error(e.stack);process.exitCode=1});
