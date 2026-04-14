"use strict";
require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config');
(async ()=>{
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);

  const zone = 'normal';
  // get monsters
  const monsters = await db.collection('monsters').find({}).sort({ seq: 1 }).toArray();
  if (!monsters.length) { console.error('no monsters'); await c.close(); return; }
  const activeSeq = monsters[0].seq;
  console.log('setting activeMonsterSeq', activeSeq);
  const state = { activeMonsterSeq: activeSeq, currentHp: 1, killCount: {}, participants: [], damageMap: {} };
  const stateDocId = `monsterState:${zone}`;
  try {
    await db.collection('monsters').updateOne({ _id: stateDocId }, { $set: { value: state, updatedAt: new Date().toISOString() } }, { upsert: true });
  } catch (e) { /* ignore */ }
  await db.collection('monsterState').updateOne({ _id: zone }, { $set: { value: state, updatedAt: new Date().toISOString() } }, { upsert: true });
  console.log('monster state set to low HP (monsters + legacy)');
  await c.close();
})().catch(e=>{ console.error(e); process.exit(1); });
