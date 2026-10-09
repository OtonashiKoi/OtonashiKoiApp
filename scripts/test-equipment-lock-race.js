'use strict';
const assert = require('node:assert/strict');
(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = 'qa_equipment_lock_race';
  const { getMongoDb, closeMongoClient } = require('../src/adapters/mongo/createMongoClient');
  const failures = [];
  try {
    const db = await getMongoDb();
    const sc = require('../src/services/createServiceContext').createServiceContext();
    const pid = 'equipment-lock-race';
    await sc.playerService.ensurePlayer(pid, pid);
    const repo = sc.progressRepository;
    const gear = { uuid: 'protected-gear', itemId: 'test-gear', itemName: '測試護面', itemType: 'equipment', equipSlot: 'head_low', tier: 'B', enhanceLevel: 5, locked: false };
    const reset = async (equipped = false) => db.collection('progress').updateOne({ playerId: pid }, { $set: { level: 50, inventory: equipped ? [] : [{ ...gear }], equipment: equipped ? { head_low: { ...gear } } : {}, characterSlots: {}, updatedAt: new Date().toISOString() } });
    const raw = () => db.collection('progress').findOne({ playerId: pid });
    const run = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch(e) { failures.push(name); console.error('FAIL', name, e.message); } };
    await run('stale inventory save cannot undo a newer lock', async () => {
      await reset(); const stale = await repo.findByPlayerId(pid);
      await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      stale.inventory.push({ uuid: 'drop', itemId: 'drop', itemType: 'consumable' });
      await repo.save(stale);
      assert.equal((await raw()).inventory.find(e => e.uuid === gear.uuid).locked, true);
      assert.equal((await raw()).inventory.some(e => e.uuid === 'drop'), true);
    });
    await run('unchanged equipment on a stale save cannot undo a newer lock', async () => {
      await reset(true); const stale = await repo.findByPlayerId(pid);
      await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      stale.exp = 17; await repo.save(stale);
      assert.equal((await raw()).equipment.head_low.locked, true);
    });
    await run('unequip preserves a newer equipment lock', async () => {
      await reset(true); const stale = await repo.findByPlayerId(pid);
      await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      stale.inventory.push(stale.equipment.head_low); stale.equipment.head_low = null;
      await repo.save(stale);
      assert.equal((await raw()).inventory.find(e => e.uuid === gear.uuid).locked, true);
    });
    await run('concurrent locking rejects stale destruction and its rewards together', async () => {
      await reset(); const stale = await repo.findByPlayerId(pid);
      await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      stale.inventory = [{ uuid: 'undeserved-gem', itemId: 'gem', itemType: 'consumable' }];
      await assert.rejects(repo.save(stale), { code: 'INVENTORY_LOCK_CONFLICT' });
      const p = await raw(); assert.equal(p.inventory[0].uuid, gear.uuid); assert.equal(p.inventory[0].locked, true); assert.equal(p.inventory.length, 1);
    });
    await run('explicit unlock still persists', async () => {
      await reset(); await sc.shopService.toggleItemLock(pid, gear.uuid, true); await sc.shopService.toggleItemLock(pid, gear.uuid, false);
      assert.equal((await raw()).inventory[0].locked, false);
    });
    await run('a stale locked snapshot cannot undo an explicit unlock', async () => {
      await reset(); await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      const stale = await repo.findByPlayerId(pid);
      await sc.shopService.toggleItemLock(pid, gear.uuid, false);
      stale.inventory.push({uuid:'drop',itemId:'drop',itemType:'consumable'}); await repo.save(stale);
      assert.equal((await raw()).inventory.find(e=>e.uuid===gear.uuid).locked, false);
    });
    await run('serialized snapshots preserve current locks', async () => {
      await reset(); const stale = JSON.parse(JSON.stringify(await repo.findByPlayerId(pid)));
      await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      await repo.save(stale); assert.equal((await raw()).inventory[0].locked, true);
    });
    await run('same-millisecond CAS save preserves a newer lock', async () => {
      await reset(); const stale = await repo.findByPlayerId(pid);
      await db.collection('progress').updateOne({playerId:pid},{$set:{'inventory.0.locked':true}});
      assert.equal(await repo.saveIfUnchanged(stale, stale.updatedAt), true);
      assert.equal((await raw()).inventory[0].locked,true);
    });
    await run('locking during web batch consumption aborts both item removal and rewards', async () => {
      await reset(); const save = repo.save;
      repo.save = async function(progress) {
        await db.collection('progress').updateOne({playerId:pid},{$set:{'inventory.0.locked':true}});
        return save.call(this, progress);
      };
      try { await assert.rejects(sc.shopService.processInventoryBatch(pid,'dismantle',[gear.uuid]),{code:'INVENTORY_LOCK_CONFLICT'}); }
      finally { repo.save=save; }
      assert.equal((await raw()).inventory.length,1); assert.equal((await raw()).inventory[0].uuid,gear.uuid);
    });
    await run('inactive character equipment remains owned and keeps its lock', async () => {
      await reset(true); const stale=await repo.findByPlayerId(pid);
      await sc.shopService.toggleItemLock(pid,gear.uuid,true);
      stale.characterSlots={'1':{equipment:stale.equipment},'2':{equipment:{}}}; stale.activeCharacterSlot=2; stale.equipment={};
      await repo.save(stale);
      assert.equal((await raw()).characterSlots['1'].equipment.head_low.locked,true);
    });
    await run('legacy gear without a locked field still saves', async () => {
      await reset(); await db.collection('progress').updateOne({playerId:pid},{$unset:{'inventory.0.locked':''}});
      const p=await repo.findByPlayerId(pid);p.exp=23;await repo.save(p);assert.equal((await raw()).exp,23);
    });
    await run('lock arriving between DB read and write defeats the exact CAS guard', async () => {
      await reset(); const stale=await repo.findByPlayerId(pid);stale.inventory=[];
      const {Collection}=require('mongodb'); const original=Collection.prototype.updateOne; let injected=false;
      Collection.prototype.updateOne=async function(filter,update,options){
        if(!injected && this.collectionName==='progress' && filter.playerId===pid && Array.isArray(filter.inventory)){
          injected=true;await original.call(this,{playerId:pid},{$set:{'inventory.0.locked':true}});
        }
        return original.call(this,filter,update,options);
      };
      try { await assert.rejects(repo.save(stale),{code:'INVENTORY_LOCK_CONFLICT'}); }
      finally { Collection.prototype.updateOne=original; }
      assert.equal(injected,true);assert.equal((await raw()).inventory[0].locked,true);
    });
    await run('web batch cannot dismantle locked +5 but can dismantle unlocked gear', async () => {
      await reset(); await sc.shopService.toggleItemLock(pid, gear.uuid, true);
      await db.collection('progress').updateOne({playerId:pid}, {$push:{inventory:{...gear,uuid:'unlocked',enhanceLevel:0}}});
      const result = await sc.shopService.processInventoryBatch(pid, 'dismantle', [gear.uuid, 'unlocked']);
      assert.equal(result.okCount, 1); assert.equal((await raw()).inventory.find(e=>e.uuid===gear.uuid).locked,true);
    });
  } finally { await closeMongoClient(); await mongo.stop(); }
  if (failures.length) throw new Error(`${failures.length} failed: ${failures.join('; ')}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
