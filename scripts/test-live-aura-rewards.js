"use strict";
require("dotenv").config({quiet:true});
const assert=require("node:assert/strict"),fs=require("node:fs");
const testDb="qa_aura_rewards_"+Date.now();process.env.MONGODB_DB_NAME=testDb;
const {getMongoDb}=require("../src/adapters/mongo/createMongoClient");
const {createServiceContext}=require("../src/services/createServiceContext");
const {playerEventBus}=require("../src/services/realtime/playerEventBus");
const {grantKillCurrencyAndExp}=require("../src/services/battle/grantKillCurrencyAndExp");
const presentation=require("../src/services/battle/battlePresentation");
for(const name of ["_announceLevelMilestone","_notifyKillRewards","notifyHealerBonus"] )presentation[name]=async()=>{};
(async()=>{
 const db=await getMongoDb();assert.equal(db.databaseName,testDb);const sc=createServiceContext();
 const ids=["qa_aura_fighter","qa_aura_support","qa_aura_idle","qa_aura_no_effect"];
 for(const id of ids){await sc.playerService.ensurePlayer(id,id);await sc.progressRepository.updateFields(id,{level:1,exp:0,equipment:{},inventory:[]});}
 const monster={id:"qa_aura_monster",seq:90001,name:"光環獎勵驗收怪",zone:"normal",calc:{maxHp:100},expReward:200,goldReward:80,drops:[]};
 const state={currentHp:0,activeMonsterSeq:monster.seq,participants:ids,damageMap:{
  [ids[0]]:{damage:100,name:ids[0]},[ids[1]]:{assist:10,name:ids[1]},[ids[3]]:{damage:0,assist:0,name:ids[3]}
 },activeHealerAuras:[{discordId:ids[2],lastAt:Date.now(),effects:[{key:"party_heal",params:{value:10},target:"party"}]}]};
 const settle=state=>grantKillCurrencyAndExp({sc,state,monster,zoneKey:"normal",discordId:ids[0],displayName:ids[0],session:{},rewardLines:[]});
 const first=await settle(state);assert.deepEqual(first.participants,[ids[0],ids[1]]);
 assert.equal(first.perPidRewards[ids[0]].exp,100);assert.equal(first.perPidRewards[ids[1]].exp,100);
 assert.equal(first.perPidRewards[ids[2]],undefined);assert.equal(first.perPidRewards[ids[3]],undefined);
 const supportBefore=await sc.progressRepository.findByPlayerId(ids[1]);
 const next=await settle({...state,participants:[ids[0]],damageMap:{[ids[0]]:{damage:100,name:ids[0]}}});
 assert.equal(next.perPidRewards[ids[0]].exp,200);assert.deepEqual(next.participants,[ids[0]]);
 const supportAfter=await sc.progressRepository.findByPlayerId(ids[1]);assert.equal(supportAfter.exp,supportBefore.exp);assert.equal(supportAfter.level,supportBefore.level);
 const levels=[];const unsubscribe=playerEventBus.subscribe(ids[2],event=>{if(event.type==="level_up")levels.push(event.data);});
 const amount=require("../src/shared/progression").expToNextLevel(1);
 const input={discordId:ids[2],displayName:ids[2],amount,source:require("../src/shared/sources").EXP_SOURCES.MONSTER_KILL,operationId:"normal-live:qa-aura-level-once"};
 await sc.progressService.grantExp(input);await sc.progressService.grantExp(input);unsubscribe();
 assert.equal(levels.length,1);assert.equal(levels[0].eventId,input.operationId);assert.equal(levels[0].characterSlot,1);
 const report={ok:true,at:new Date().toISOString(),testDb,checks:["real Mongo: effective support shares original EXP pool","idle registered aura receives no EXP","zero effective support receives no EXP","prior support preserved on its encounter","stopped provider receives no following encounter EXP","EXP retry emits one stable level-up identity"],firstShares:Object.fromEntries(Object.entries(first.perPidRewards).map(([id,r])=>[id,r.exp])),nextShares:Object.fromEntries(Object.entries(next.perPidRewards).map(([id,r])=>[id,r.exp]))};
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});
