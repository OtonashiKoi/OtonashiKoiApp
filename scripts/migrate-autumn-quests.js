'use strict';
require('dotenv').config({quiet:true});
const fs=require('fs'),assert=require('assert/strict');
const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
const GEM_B='8fdfa7d9-f0fa-4e6a-a291-703b1e354072';
function definitions(){const entries=[
 ['daily','battle_count',30,'每日冒險',1000,0],
 ['daily','battle_win',20,'每日討伐',1000,0],
 ['daily','checkin_count',1,'每日報到',1000,0],
 ['weekly','battle_count',500,'每週冒險',6000,0],
 ['weekly','battle_win',300,'每週討伐',6000,0],
 ['weekly','equip_count',5,'整理裝備',4000,0],
 ['weekly','enhance_count',3,'強化養成',4000,0],
 ['weekly','checkin_count',5,'每週報到',4000,0],
 ['weekly','party_floor_clear',20,'組隊探索',6000,30],
 ['season','battle_win',3000,'楓紅百戰',10000,0],
 ['season','party_floor_clear',100,'夥伴的足跡',10000,30]
 ];const quests=entries.map(([cadence,type,target,title,rewardGold,unlockLevel],i)=>({id:`autumn-202610-${cadence}-${type}`,cadence,type,target,title,description:cadence==='season'?`本季累積${target}${type==='party_floor_clear'?'樓組隊副本通關':'場勝利'}。`:type==='party_floor_clear'?`通關組隊副本累積${target}樓；已擊敗樓層即計入，不要求整塔通關。`:`本${cadence==='daily'?'日':'週'}累積${target}${type==='checkin_count'?'次報到':type==='equip_count'?'次穿戴裝備':type==='enhance_count'?'次強化':type==='battle_win'?'場勝利':'次出戰'}。`,enabled:true,groupKey:'autumn_202610_v1',resetPolicy:cadence==='daily'?'tw_daily':cadence==='weekly'?'tw_weekly':'once',claimOnce:cadence==='season',hideIfRewardOwned:false,unlockLevel,levelLimit:0,rewardGold,rewardExp:0,rewardDiamond:0,rewardItemId:null,rewardItems:cadence==='season'?[{itemId:GEM_B,qty:3}]:[],sortOrder:10+i*10}));quests.push({id:'autumn-202610-daily-daily_complete_count',cadence:'daily',type:'daily_complete_count',target:3,title:'每日全清獎勵',description:'完成全部每日任務，領取記憶錨定卡包 ×1。',enabled:true,groupKey:'autumn_202610_v1',resetPolicy:'tw_daily',claimOnce:false,hideIfRewardOwned:false,unlockLevel:0,levelLimit:0,rewardGold:0,rewardExp:0,rewardDiamond:0,rewardItemId:null,rewardItems:[{itemId:'chest-anchor-pack',qty:1}],sortOrder:40});return quests.map(q=>q.id===require("../src/shared/partyWeeklyReward").QUEST_ID?{...q,...require("../src/shared/partyWeeklyReward").questPatch}:q);}
async function main(){const db=await getMongoDb(),defs=definitions();for(const d of defs)for(const i of d.rewardItems)assert(await db.collection('items').findOne({id:i.itemId}));const old=await db.collection('weeklyQuests').find({$or:[{cadence:{$in:['daily','weekly','season']}},{rewardItemId:/^s-legend-/},{id:'season-summer-four-kings'}]}).toArray();console.log(JSON.stringify({newQuests:defs,disable:old.filter(d=>d.groupKey!=='autumn_202610_v1').map(d=>({id:d.id,title:d.title})),apply:process.argv.includes('--apply')}));if(!process.argv.includes('--apply'))return;const backup=process.argv.find(x=>x.startsWith('--backup='))?.slice(9);assert(backup&&fs.existsSync(backup+'/weeklyQuests.bson'),'verified backup required');const now=new Date().toISOString();for(const d of old.filter(d=>d.groupKey!=='autumn_202610_v1'))await db.collection('weeklyQuests').updateOne({id:d.id},{$set:{enabled:false,disabledReason:'autumn_202610_replaced',updatedAt:now}});for(const d of defs)await db.collection('weeklyQuests').updateOne({id:d.id},{$set:{...d,updatedAt:now},$setOnInsert:{createdAt:now}},{upsert:true});for(const d of defs){const live=await db.collection('weeklyQuests').findOne({id:d.id});for(const k of Object.keys(d))assert.deepEqual(live[k],d[k]);}console.log('PASS autumn quest migration/readback; job/onboarding definitions and player progress preserved');}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1}).finally(closeMongoClient);module.exports={definitions};
