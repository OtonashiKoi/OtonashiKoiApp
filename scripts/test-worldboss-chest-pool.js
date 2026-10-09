"use strict";
require('dotenv').config({quiet:true});
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{MongoClient}=require('mongodb');
const snapshot=process.argv[2],output=process.argv[3];assert.ok(snapshot&&output,'snapshot and output required');
const source=JSON.parse(fs.readFileSync(snapshot));
const dbName='qa_worldboss_chests_'+Date.now();process.env.MONGODB_DB_NAME=dbName;
const client=new MongoClient(process.env.MONGODB_URI),nativeRandom=Math.random;
(async()=>{
 await client.connect();const db=client.db(dbName);assert.ok(db.databaseName.startsWith('qa_worldboss_chests_'));
 for(const [collection,rows] of [['items',source.items],['monsters',source.monsters]])await db.collection(collection).insertMany(rows.map(({_id,...r})=>r));
 const mongo=require('../src/adapters/mongo/createMongoClient');mongo.getMongoDb=async()=>db;
 const repos=require('../src/adapters/mongo/createMongoRepositories').createMongoRepositories();
 require('../src/services/realtime/playerNotifyService').notifyPlayer=()=>{};
 const {ShopService}=require('../src/services/shop/shopService');
 const shop=new ShopService(null,null,null,repos.progressRepository,null,repos.itemRepository,null);
 const {buildMonsterDropPool}=require('../src/services/battle/battleRewardRules');
 const {isUnavailableEquipment}=require('../src/shared/equipmentAvailability');
 const items=new Map(source.items.map(x=>[x.id,x]));const monsters=new Map(source.monsters.map(x=>[x.id,x]));
 const memoryShop=Object.create(ShopService.prototype);memoryShop.itemRepository={findById:async id=>items.get(id)};
 const report={testDb:dbName,productionWrites:false,checks:[],pools:[]};
 async function check(name,fn){await fn();report.checks.push({name,passed:true});console.log('PASS',name);}
 let hutaoPool;
 await check('all seven chests reach every available combat drop, including old chestDrops exclusions',async()=>{
  mongo.getMongoDb=async()=>({collection:name=>{assert.equal(name,'monsters');return {findOne:async q=>monsters.get(q.id)};}});
  for(const chest of source.chests){const mon=monsters.get(chest.effect.monsterId);assert.ok(mon);const pool=(await buildMonsterDropPool(memoryShop,mon)).filter(d=>Number(d.chance)>0&&items.has(d.itemId)&&!isUnavailableEquipment(d.itemId)&&!isUnavailableEquipment(items.get(d.itemId)));
   let offset=0;const total=pool.reduce((s,d)=>s+Number(d.chance),0);assert.ok(total>0);
   for(const d of pool){for(const w of [offset+1e-8,offset+Number(d.chance)/2,offset+Number(d.chance)-1e-8]){let first=true;Math.random=()=>{if(first){first=false;return w/total;}return .5;};assert.equal((await memoryShop._rollWorldBossChest(mon.id)).entry.itemId,d.itemId);}offset+=Number(d.chance);}
   report.pools.push({chestId:chest.id,boss:mon.name,count:pool.length,totalWeight:total,rows:pool.map(d=>({id:d.itemId,name:items.get(d.itemId).name,pct:Number(d.chance)/total*100}))});if(mon.id==='event-northwind-hutao')hutaoPool=pool;
  }
 });
 await check('Hutao 100000 seeded actual draws match full 22-item pool',async()=>{
  assert.equal(hutaoPool.length,22);assert.equal(hutaoPool.reduce((n,d)=>n+d.chance,0),100);
  let seed=20261008;Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};const counts={},n=100000;
  for(let i=0;i<n;i++){const r=await memoryShop._rollWorldBossChest('event-northwind-hutao');counts[r.entry.itemId]=(counts[r.entry.itemId]||0)+1;}
  for(const d of hutaoPool){const p=d.chance/100;assert.ok(Math.abs((counts[d.itemId]-n*p)/Math.sqrt(n*p*(1-p)))<6);}
  report.simulation={seed:20261008,draws:n,counts};
 });
 await check('live drop table updates take effect; missing/disabled/zero-chance items never win; empty pool rejects',async()=>{
  const mon=monsters.get('event-northwind-hutao'),before=mon.drops,oldCard=mon.equipment;
  try{mon.equipment={};mon.drops=[{itemId:'gem-s-tier',chance:1},{itemId:'missing',chance:999},{itemId:'hutao-wind-bow',chance:0}];Math.random=()=>.5;assert.equal((await memoryShop._rollWorldBossChest(mon.id)).entry.itemId,'gem-s-tier');mon.drops=[];assert.equal(await memoryShop._rollWorldBossChest(mon.id),null);}finally{mon.drops=before;mon.equipment=oldCard;}
 });
 mongo.getMongoDb=async()=>db;Math.random=nativeRandom;
 const {createGameProgress}=require('../src/domain/progress/createGameProgress');
 const chest=source.chests.find(c=>c.id==='chest-northwind-hutao');
 async function seedPlayer(id,count){const p=createGameProgress(id);p.level=50;p.inventory=[{uuid:id+'-chest',itemId:chest.id,itemName:chest.name,itemType:'consumable',itemEffect:chest.effect,stackCount:count}];await repos.progressRepository.save(p);return id+'-chest';}
 await check('real Mongo open consumes exactly one chest, persists reward, CAS retries keep one draw',async()=>{
  const id='qa-chest-retry',uuid=await seedPlayer(id,2);let saves=0,draws=0;const save=shop._saveProgressWithFallback.bind(shop),roll=shop._rollWorldBossChest.bind(shop);
  shop._saveProgressWithFallback=async(...args)=>++saves<3?false:save(...args);shop._rollWorldBossChest=async(...args)=>{draws++;return roll(...args);};
  const result=await shop.useItem(id,uuid,'QA');const p=await repos.progressRepository.findByPlayerId(id);assert.equal(p.inventory.find(e=>e.itemId===chest.id).stackCount,1);assert.equal(p.inventory.filter(e=>e.source==='world_boss_chest').length,1);assert.equal(p.inventory.find(e=>e.source==='world_boss_chest').itemId,result.chestReward.rewardItemId);assert.equal(draws,1);assert.equal(saves,3);shop._saveProgressWithFallback=save;shop._rollWorldBossChest=roll;
 });
 await check('one remaining chest with concurrent duplicate use grants exactly one reward; failure preserves chest',async()=>{
  const id='qa-chest-duplicate',uuid=await seedPlayer(id,1);const results=await Promise.allSettled([shop.useItem(id,uuid,'QA'),shop.useItem(id,uuid,'QA')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const p=await repos.progressRepository.findByPlayerId(id);assert.equal(p.inventory.filter(e=>e.itemId===chest.id).length,0);assert.equal(p.inventory.filter(e=>e.source==='world_boss_chest').length,1);
  const failId='qa-chest-failed',failUuid=await seedPlayer(failId,1);const save=shop._saveProgressWithFallback;shop._saveProgressWithFallback=async()=>false;await assert.rejects(shop.useItem(failId,failUuid,'QA'),/CAS failed/);shop._saveProgressWithFallback=save;const fp=await repos.progressRepository.findByPlayerId(failId);assert.equal(fp.inventory[0].stackCount,1);assert.equal(fp.inventory.length,1);
 });
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log('Evidence',output);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{Math.random=nativeRandom;await client.close();});
