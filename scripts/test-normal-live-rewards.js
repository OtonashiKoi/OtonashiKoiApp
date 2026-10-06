"use strict";
require('dotenv').config();
const assert=require('node:assert/strict'),fs=require('node:fs');
const testDb='qa_normal_live_'+Date.now();process.env.MONGODB_DB_NAME=testDb;
const {getMongoDb}=require('../src/adapters/mongo/createMongoClient');
const {createServiceContext}=require('../src/services/createServiceContext');
const presentation=require('../src/services/battle/battlePresentation');
for(const name of ['_announceDrops','notifyHealerBonus','_announceLevelMilestone','_notifyKillRewards','_republishPanel'])presentation[name]=async()=>{};
const {encounterKey}=require('../src/services/realtime/normalLiveJournal');
const {handleMonsterKill}=require('../src/services/battle/monsterKillSettlement');
const {recoverPendingLiveRewards}=require('../src/services/realtime/normalLiveRecovery');
(async()=>{
 const db=await getMongoDb();assert.equal(db.databaseName,testDb);const sc=createServiceContext();
 await db.collection('weeklyQuests').insertOne({id:'qa-live-win',name:'驗收勝場',cadence:'daily',type:'battle_win',target:100,enabled:true});
 const ids=['qa_live_A','qa_live_B'];for(const id of ids){await sc.playerService.ensurePlayer(id,id);await sc.progressRepository.updateFields(id,{level:10,exp:0,equipment:{},inventory:[]});}
 const item={id:'qa_live_material',name:'驗收素材',itemType:'material',tier:'D'};await sc.itemRepository.save(item);
 const gemId=require("../src/services/battle/zoneBattleState").ENHANCE_GEM_IDS.D;await sc.itemRepository.save({id:gemId,name:"驗收D石",itemType:"material",tier:"D"});
 const monster={id:'qa_live_monster',seq:90001,name:'驗收怪',zone:'normal',enabled:true,calc:{maxHp:100},level:10,expReward:200,goldReward:80,drops:[{itemId:item.id,chance:100}],equipment:{}};
 await sc.monsterRepository.save({...monster,attributes:{str:1,agi:1,vit:1,int:1,dex:1,luk:1}});
 let state={activeMonsterSeq:monster.seq,currentHp:0,encounterCount:3,encounterMonsterSeq:monster.seq,killCount:{},participants:ids,damageMap:Object.fromEntries(ids.map(id=>[id,{damage:50,name:id}]))};
 state.normalLive={encounterKey:encounterKey('normal',monster.seq,state),seq:monster.seq,actors:Object.fromEntries(ids.map(id=>[id,{id:id+'-session',name:id,hp:100,maxHp:100,active:false}]))};
 state.normalLive.npcs={archer:{damage:200,hp:200,maxHp:425,level:6,selected:true},bard:{damage:0,hp:425,maxHp:425,level:6,selected:false}};
 await sc.monsterRepository.saveState(state,'normal');
 const grant=sc.progressService.grantExp.bind(sc.progressService);let failed=false;
 sc.progressService.grantExp=async input=>{if(!failed){failed=true;throw Error('injected after gold, before EXP');}return grant(input);};
 await assert.rejects(handleMonsterKill({serviceContext:sc,zoneKey:'normal',monster,state,discordId:ids[0],displayName:ids[0],session:{}}),/injected/);
 const before=await Promise.all(ids.map(id=>sc.walletRepository.findByPlayerId(id)));assert.ok(before.every(w=>w.gold>0));
 const pending=await sc.monsterService.getState('normal');assert.equal(pending.currentHp,0);assert.equal(pending.normalLive.killReceipt,true);assert.ok(!pending.normalLive.settlementComplete);
 sc.progressService.grantExp=grant;
 const originalRandom=Math.random;Math.random=()=>0.01;
 const list=sc.monsterService.listMonsters.bind(sc.monsterService);let interrupted=false;
 sc.monsterService.listMonsters=async input=>{if(!interrupted){interrupted=true;throw Error("injected after grants, before transition");}return list(input);};
 await assert.rejects(handleMonsterKill({serviceContext:sc,zoneKey:'normal',monster,state:pending,discordId:ids[0],displayName:ids[0],session:{},resumeLiveSettlement:true}),/before transition/);
 const granted=await Promise.all(ids.map(id=>sc.progressRepository.findByPlayerId(id)));
 const uuidBefore=granted.map(p=>p.inventory.map(e=>e.uuid));
 const resumeState=await sc.monsterService.getState('normal');sc.monsterService.listMonsters=list;Math.random=()=>0.99;
 const lines=await handleMonsterKill({serviceContext:sc,zoneKey:'normal',monster,state:resumeState,discordId:ids[0],displayName:ids[0],session:{},resumeLiveSettlement:true});
 const after=await Promise.all(ids.map(id=>sc.walletRepository.findByPlayerId(id)));assert.deepEqual(after.map(w=>w.gold),before.map(w=>w.gold),'gold retry duplicated');
 for(const id of ids){const p=await sc.progressRepository.findByPlayerId(id,{includeLiveRewardReceipts:true});assert.equal(p.inventory.filter(e=>e.itemId===item.id).length,3,'each player needs 3 individual rolls');assert.equal(p.expGrantReceipts.length,1);assert.equal(p.normalLiveDropReceipts.filter(r=>r.id.includes('normal-live:')).length,2);assert.equal(lines._perPidRewards[id].exp,547,'200 EXP × 3 monsters × 120% group bonus × 80% × 95% zone modifier');assert.equal(p.exp,547,'group EXP bonus is durably committed once');}
 const uuidAfter=await Promise.all(ids.map(async id=>(await sc.progressRepository.findByPlayerId(id)).inventory.map(e=>e.uuid)));assert.deepEqual(uuidAfter,uuidBefore,"recovery rerolled or duplicated items");
 const completed=await sc.monsterService.getState('normal');assert.equal(completed.normalLive.settlementComplete,true);
 assert.deepEqual(Object.keys(lines._perPidRewards).sort(),ids.slice().sort(),'NPCs cannot dilute human EXP or receive rewards');
 for(const id of ['starter-npc:normal:archer','starter-npc:normal:bard']){assert.equal(await sc.progressRepository.findByPlayerId(id),null);assert.equal(await sc.walletRepository.findByPlayerId(id),null);}
 await recoverPendingLiveRewards(sc,'normal');const unchanged=await sc.progressRepository.findByPlayerId(ids[0]);assert.equal(unchanged.inventory.filter(e=>e.itemId===item.id).length,3);
 await new Promise(r=>setTimeout(r,100));
 const questRows=await db.collection('weeklyQuestProgress').find({}).toArray();assert.ok(questRows.length>=2);for(const row of questRows.filter(x=>x.cadence==='daily')){assert.equal(row.progress?.['qa-live-win']?.current ?? row.value?.['qa-live-win']?.current ?? row['qa-live-win']?.current,3,'reward recovery must not multiply quest wins');}
 const key1=state.normalLive.encounterKey,key2=encounterKey('normal',monster.seq,{killCount:{[monster.id]:3}});assert.notEqual(key1,key2,'same species next spawn must be a new kill');
 const bagPid='qa_live_full_bag';await sc.playerService.ensurePlayer(bagPid,bagPid);
 const gear=index=>({uuid:'bag-'+index,itemId:'qa_armor',itemType:'equipment',equipSlot:'armor'});
 await sc.progressRepository.updateFields(bagPid,{inventory:Array.from({length:150},(_,i)=>gear(i))});
 const journal=require('../src/services/realtime/normalLiveJournal');
 const bagDrops=[gear('new'),{uuid:'bag-material',itemId:item.id,itemType:'material'}];
 const bagGrant={playerId:bagPid,id:'qa-full-bag',entries:bagDrops};
 const [picked]=await Promise.all([
  journal.grantInventoryBatch(sc,[bagGrant]),
  sc.progressRepository.updateFields(bagPid,{activeEffects:[{key:'qa-concurrent-edit'}]})
 ]);
 assert.deepEqual(picked[bagPid]['qa-full-bag'],bagDrops,'full bag must accept all earned loot');
 const duplicate=await journal.grantInventoryBatch(sc,[{...bagGrant,entries:[gear('changed')]}]);
 assert.deepEqual(duplicate[bagPid]['qa-full-bag'],bagDrops,'receipt replay returns original loot');
 const bag=await sc.progressRepository.findByPlayerId(bagPid);
 assert.equal(bag.inventory.filter(e=>e.itemType==='equipment').length,151);assert.equal(bag.inventory.filter(e=>e.uuid==='bag-material').length,1);
 assert.equal(bag.activeEffects[0].key,'qa-concurrent-edit','atomic loot append preserves concurrent progress edits');
 const gate=await require('../src/services/backpack/backpackService').checkBackpackFullForBattle(bagPid,bag.inventory);
 assert.ok(gate&&gate.count===151&&gate.cap===150,'full bag blocks the next battle');
 const bulk=sc.progressRepository.grantInventoryRewardsBatch.bind(sc.progressRepository);
 const partial=ids.map(pid=>({playerId:pid,id:'qa-partial-bulk',entries:[{uuid:'partial-'+pid,itemId:item.id,itemType:'material'}]}));
 sc.progressRepository.grantInventoryRewardsBatch=async grants=>{await bulk(grants.slice(0,1));throw Error('injected partial bulk');};
 await assert.rejects(journal.grantInventoryBatch(sc,partial),/partial bulk/);
 sc.progressRepository.grantInventoryRewardsBatch=bulk;
 await Promise.all([journal.grantInventoryBatch(sc,partial),journal.grantInventoryBatch(sc,partial)]);
 for(const pid of ids){const p=await sc.progressRepository.findByPlayerId(pid);assert.equal(p.inventory.filter(e=>e.uuid==='partial-'+pid).length,1,'partial bulk replay must append once');}
 await assert.rejects(journal.grantInventoryBatch(sc,[{playerId:bagPid,id:'qa-wrong-season',seasonKey:'wrong-season',entries:[gear('wrong-season')]}]),/not committed/);
 assert.equal((await sc.progressRepository.findByPlayerId(bagPid)).inventory.some(e=>e.uuid==='bag-wrong-season'),false,'stale season cannot receive loot');
 const result={at:new Date().toISOString(),testDb,checks:['real Mongo gold partially committed then retried once','real EXP applied once per player','each of 2 players receives 3 independent drop rolls','participation stones have durable receipt','crash after all grants: changed RNG does not reroll or duplicate inventory','completed recovery does not duplicate grants','repeated settlement keeps quest wins once per encounter','same monster next spawn gets distinct identity','full bag receives gear and material; next battle blocked','atomic loot append preserves concurrent edits','partial bulk and concurrent replay append once','stale season loot rejected'],rewards:lines._perPidRewards};
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify(result));Math.random=originalRandom;process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});
