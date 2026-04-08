"use strict";
require('dotenv').config();
const { MongoClient } = require('mongodb');
const config = require('../src/config');
(async()=>{
  const c = new MongoClient(config.storage.mongoUri);
  await c.connect();
  const db = c.db(config.storage.mongoDbName);
  const p = await db.collection('progress').findOne({ playerId: 'tester1' });
  console.log(JSON.stringify(p, null, 2));
  await c.close();
})().catch(e=>{console.error(e);process.exit(1)});
