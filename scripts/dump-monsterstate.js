"use strict";
require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config');
(async()=>{
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);
  const doc = await db.collection('monsterState').findOne({ _id: 'normal' });
  console.log(JSON.stringify(doc, null, 2));
  const docMid = await db.collection('monsterState').findOne({ _id: 'mid' });
  console.log('--- mid ---');
  console.log(JSON.stringify(docMid, null, 2));
  await c.close();
})();
