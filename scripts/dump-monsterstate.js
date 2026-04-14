"use strict";
require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config');
(async()=>{
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);
  async function loadState(zone) {
    const stateDocId = `monsterState:${zone}`;
    const monstersRow = await db.collection('monsters').findOne({ _id: stateDocId }).catch(() => null);
    if (monstersRow && monstersRow.value) return monstersRow;
    const legacy = await db.collection('monsterState').findOne({ _id: zone }).catch(() => null);
    if (legacy) return legacy;
    if (zone === 'normal') {
      const legacyDefault = await db.collection('monsterState').findOne({ _id: 'default' }).catch(() => null);
      return legacyDefault || { value: { activeMonsterSeq: 1, currentHp: null, killCount: {} } };
    }
    return { value: { activeMonsterSeq: 1, currentHp: null, killCount: {} } };
  }

  const doc = await loadState('normal');
  console.log(JSON.stringify(doc, null, 2));
  const docMid = await loadState('mid');
  console.log('--- mid ---');
  console.log(JSON.stringify(docMid, null, 2));
  await c.close();
})();
