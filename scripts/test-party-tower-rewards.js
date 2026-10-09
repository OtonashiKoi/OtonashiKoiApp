"use strict";
const assert = require("node:assert/strict"), fs = require("fs"), crypto = require("crypto");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const { readBson } = require("./deploy-party-tower-rewards");
const rules = require("../src/shared/partyTowerRewardRules");
async function main() {
  const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
  assert(snapshot, "provide parse-verified snapshot");
  const checks = [], server = await MongoMemoryServer.create(), client = await MongoClient.connect(server.getUri()), db = client.db("tower_rewards_isolated");
  require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => db;
  const check = async (name, fn) => { try { await fn(); checks.push({ name, passed: true }); } catch(e) { checks.push({ name, passed: false, error: e.stack }); } };
  try {
    await require("../src/services/access/seasonStateStore").activate("tower-reward-test");
    await require("../src/services/access/maintenanceStore").setState({ enabled: false, strict: false });
    const items = readBson(snapshot + "/items.bson").map(({ _id, ...item }) => item);
    await db.collection("items").insertMany([...items, ...rules.boxes(items.find(i => i.id === "chest-a-weapon-select"))]);
    await db.collection("weeklyQuests").insertMany(rules.quests());
    const repos = require("../src/adapters/mongo/createMongoRepositories").createMongoRepositories();
    const { WeeklyQuestService } = require("../src/services/weeklyQuest/weeklyQuestService");
    const { grantAutumnQuestReward } = require("../src/services/weeklyQuest/autumnQuestRewards");
    const { fixture, setup } = require("./test-party-tower-v2");
    let lostQuestReply = false;
    const questRepo = { ...repos.weeklyQuestRepository, savePlayerProgress: async (...args) => {
      if(lostQuestReply) { lostQuestReply = false; throw Error("quest reply lost"); }
      await repos.weeklyQuestRepository.savePlayerProgress(...args);
    } };
    const serviceContext = { progressRepository: repos.progressRepository, itemRepository: repos.itemRepository };
    const qs = new WeeklyQuestService(questRepo, { getProfile: async id => ({ progress: await repos.progressRepository.findByPlayerId(id) }) }, { ...serviceContext, isOpen: () => false });
    qs._getPlayerQuestContext = async () => ({ level: 50, attributes: {}, equipment: {}, ownedItemIds: new Set() });
    const amount = (p, id, field = "inventory") => (p[field] || []).filter(e => e.itemId === id).reduce((n,e) => n + (e.stackCount || 1), 0);
    const gemstone = require("../src/shared/enhanceConfig").ENHANCE_GEMS;
    const complete = async (difficulty, failFloor = null, random = () => 0) => {
      const f = fixture(); f.opts.rewardRandom = random; f.opts.encounterRandom = () => 0; f.opts.capacity = async () => 0;
      f.sc.itemRepository = repos.itemRepository; f.sc.questService = qs;
      f.opts.fightFloor = async session => ({ survived: session.currentFloor !== failFloor, monsterKilled: session.currentFloor !== failFloor,
        rounds: 1, logs: [], memberLogs: [], memberDamage: session.members.map(m => ({ discordId: m.discordId, damageDealt: 100 })) });
      const tower = await setup(f, difficulty); await tower.startRoom("party-test-1");
      for(let i=0;i<120;i++) { f.advance(); await tower.tick(); if((await tower.getState("party-test-1")).settled) break; }
      const state = await tower.getState("party-test-1"); tower.close(); return { f, tower, state };
    };
    await check("five-floor boundaries and quantity extremes", async () => {
      for(const floor of [0,1,4,6,29,31,51]) assert.deepEqual(rules.checkpoint("normal",floor),[]);
      assert.equal(rules.checkpoint("normal",5,()=>0)[0].qty,3); assert.equal(rules.checkpoint("normal",5,()=>.999)[0].qty,5);
      assert.equal(rules.checkpoint("challenge",50,()=>.999)[0].qty,6); assert.equal(rules.checkpoint("challenge",50)[1].qty,1);
    });
    await check("4-floor failure earns no checkpoint and no first-clear", async () => {
      const {f,state} = await complete("normal",5); assert.equal(state.clearedFloor,4);
      assert.equal(amount(f.players.get("party-test-1"),gemstone.A),0);
      assert.equal((await repos.weeklyQuestRepository.getPlayerProgress("party-test-1","season-v1","season"))[rules.quests()[0].id],undefined);
    });
    await check("5-floor failure retains one checkpoint, no first-clear", async () => {
      const {f,state} = await complete("normal",6); assert.equal(state.clearedFloor,5); assert.equal(amount(f.players.get("party-test-1"),gemstone.A),3);
    });
    await check("full normal clear 6 packs/18 A, dead member eligible, progress capped and retries stable", async () => {
      const {f,tower,state} = await complete("normal"); assert.equal(state.clearedFloor,30); assert.equal(state.settled,true);
      for(const p of f.players.values()) if(p.playerId === "party-test-1" || p.playerId === "party-test-2") { assert.equal(amount(p,gemstone.A),18); assert.equal(amount(p,gemstone.S),0); }
      const before=structuredClone(f.players.get("party-test-1")); await tower.tick(); assert.deepEqual(f.players.get("party-test-1"),before);
      const room=[...f.rooms.values()][0],reward=room.rewards["party-test-1"];room.members[0].currentHp=0;
      await require("../src/services/tower/partyTowerBonusDrops").addCheckpointDrops(f.sc,room,Date.now(),()=>.999);
      assert.equal(reward.drops.find(e=>e.source==='party_tower_checkpoint').stackCount,18);
      const pp=await repos.weeklyQuestRepository.getPlayerProgress("party-test-1","season-v1","season");assert.equal(pp[rules.quests()[0].id].current,1);assert(!pp[rules.quests()[1].id]);
    });
    await check("full challenge clear 10 packs/60 A/10 S and repeated clears do not increase first-clear", async () => {
      const {f,state}=await complete("challenge",null,()=>.999);assert.equal(state.clearedFloor,50);
      for(const id of ["party-test-1","party-test-2"]){const p=f.players.get(id);assert.equal(amount(p,gemstone.A),60);assert.equal(amount(p,gemstone.S),10);}
      await complete("challenge");const pp=await repos.weeklyQuestRepository.getPlayerProgress("party-test-1","season-v1","season");assert.equal(pp[rules.quests()[1].id].current,1);
    });
    await db.collection("progress").insertOne({ playerId:"party-test-1",seasonKey:"tower-reward-test",level:50,inventory:[],equipment:{},updatedAt:new Date().toISOString() });
    const claim = q => qs.claimReward("party-test-1",q.id,r=>grantAutumnQuestReward(serviceContext,"party-test-1","tester",r));
    await check("seasonal first-clear claim lost response, concurrent claims and cross-character once", async () => {
      lostQuestReply=true;await assert.rejects(claim(rules.quests()[0]),/reply lost/);
      const responses=await Promise.allSettled(Array.from({length:8},()=>claim(rules.quests()[0])));assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(amount(await repos.progressRepository.findByPlayerId("party-test-1"),rules.REWARDS.normal.boxId),1);
      await db.collection("progress").updateOne({playerId:"party-test-1"},{$set:{activeCharacterSlot:2}});
      await assert.rejects(claim(rules.quests()[0]),/已領取/);await claim(rules.quests()[1]);
      assert.equal(amount(await repos.progressRepository.findByPlayerId("party-test-1"),rules.REWARDS.challenge.boxId),1);
    });
    const {ShopService}=require("../src/services/shop/shopService");
    const shop=new ShopService(null,null,null,repos.progressRepository,null,repos.itemRepository,null);
    let cap=100, lostInventoryReply=false, casFailures=0;
    const actualSave=shop.progressRepository.saveIfUnchanged.bind(shop.progressRepository);
    shop.progressRepository={...shop.progressRepository,saveIfUnchanged:async(...args)=>{if(casFailures-->0)return false;const ok=await actualSave(...args);if(ok&&lostInventoryReply){lostInventoryReply=false;throw Error('inventory reply lost');}return ok;}};
    const choice=require("../src/services/shop/weaponChoiceChest").createWeaponChoiceService(shop,{capacity:async()=>cap});
    const box = async tier => (await repos.progressRepository.findByPlayerId("party-test-1")).inventory.find(e=>e.itemId===rules.REWARDS[tier].boxId);
    await check("real A/S pools each 44 weapons and reject other ownership/tier/offhand/event/locked/full",async()=>{
      const a=await box("normal"),s=await box("challenge"),poolA=await choice.list("party-test-1",a.uuid),poolS=await choice.list("party-test-1",s.uuid);
      assert.equal(poolA.choices.length,44);assert.equal(poolS.choices.length,44);assert.equal(new Set(poolA.choices.map(i=>i.weaponType)).size,11);
      await assert.rejects(choice.list("other",a.uuid),/找不到/);
      const reject=async id=>{const before=await repos.progressRepository.findByPlayerId('party-test-1');await assert.rejects(choice.open('party-test-1',a.uuid,id,crypto.randomUUID()));assert.deepEqual(await repos.progressRepository.findByPlayerId('party-test-1'),before);};
      for(const id of [poolS.choices[0].itemId,'dragon-a-offhand-dagger','beach-sword-1h','missing'])await reject(id);
      cap=0;await reject(poolA.choices[0].itemId);cap=100;
      await assert.rejects(shop.useItem('party-test-1',a.uuid),/先選擇/);
      await db.collection('progress').updateOne({playerId:'party-test-1'},{$set:{'inventory.0.locked':true}});await assert.rejects(choice.list('party-test-1',a.uuid),/鎖定/);
      await db.collection('progress').updateOne({playerId:'party-test-1'},{$unset:{'inventory.0.locked':''}});
    });
    await check("selected weapon grants exactly once through CAS retry/lost reply/concurrency and op reuse rejection",async()=>{
      const a=await box('normal'),pool=await choice.list('party-test-1',a.uuid),item=pool.choices[0].itemId,operation=crypto.randomUUID();casFailures=2;lostInventoryReply=true;
      await assert.rejects(choice.open('party-test-1',a.uuid,item,operation),/reply lost/);
      const results=await Promise.all(Array.from({length:8},()=>choice.open('party-test-1',a.uuid,item,operation)));assert(results.every(r=>r.uuid===results[0].uuid));
      const p=await repos.progressRepository.findByPlayerId('party-test-1');assert.equal(amount(p,a.itemId),0);assert.equal(amount(p,item),1);
      assert.equal(p.inventory.find(e=>e.itemId===item).tier,'A');assert.equal(p.inventory.find(e=>e.itemId===item)._id,undefined);
      await assert.rejects(choice.open('party-test-1',a.uuid,pool.choices[1].itemId,operation),/其他選擇/);
      const s=await box('challenge'),spool=await choice.list('party-test-1',s.uuid);
      const attempts=await Promise.allSettled(Array.from({length:8},()=>choice.open('party-test-1',s.uuid,spool.choices[0].itemId,crypto.randomUUID())));assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(amount(await repos.progressRepository.findByPlayerId('party-test-1'),s.itemId),0);
    });
    await check("season reset clears weapon-choice receipts and boxes, seasonal quest renewal",async()=>{
      const p=await repos.progressRepository.findByPlayerId('party-test-1'),update=require('../src/services/admin/seasonResetPolicy').buildProgressResetUpdate(p);
      assert.equal(update.$unset.weaponChoiceReceipts,'');assert(!update.$set.inventory.some(e=>Object.values(rules.REWARDS).some(r=>r.boxId===e.itemId)));
      await db.collection('weeklyQuestProgress').deleteMany({discordId:'party-test-1',cadence:'season'});
      await db.collection('progress').updateOne({playerId:'party-test-1'},update);
      await require('../src/services/access/seasonStateStore').activate('tower-reward-next');
      await db.collection('progress').updateOne({playerId:'party-test-1'},{$set:{seasonKey:'tower-reward-next',level:50}});
      await qs.recordProgressBatch('party-test-1',{party_tower_normal_clear:1},{operationId:'new-season-clear'});await claim(rules.quests()[0]);
      assert.equal(amount(await repos.progressRepository.findByPlayerId('party-test-1'),rules.REWARDS.normal.boxId),1);
    });
    const report={passed:checks.every(c=>c.passed),checks,selectionPools:{A:44,S:44},sourceHashes:Object.fromEntries(['src/shared/partyTowerRewardRules.js','src/services/tower/partyTowerRoomsV2.js','src/services/tower/partyTowerProgress.js','src/services/shop/weaponChoiceChest.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
    console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
  } finally { await client.close(); await server.stop(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
