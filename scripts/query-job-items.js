#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const envPath = path.resolve(__dirname, '..', '.env');
let uri = process.env.MONGODB_URI;
let dbName = process.env.MONGODB_DB_NAME || 'equipment_game';

if (!uri && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const matchUri = content.match(/^MONGODB_URI=(.+)$/m);
  if (matchUri) {
    uri = matchUri[1].trim().replace(/^"|"$/g, '');
  }
  const matchDb = content.match(/^MONGODB_DB_NAME=(.+)$/m);
  if (matchDb) dbName = matchDb[1].trim().replace(/^"|"$/g, '');
}

if (!uri) {
  console.error('MONGODB_URI not found in .env or process.env');
  process.exit(2);
}

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const q = {
    $or: [
      { equipSlot: 'job_eq' },
      { name: { $regex: '劍|劍士|sword|Swords', $options: 'i' } }
    ]
  };

  const docs = await db.collection('items').find(q).toArray();

  const out = docs.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    equipSlot: item.equipSlot,
    tier: item.tier,
    equipStats: item.equipStats,
    weaponType: item.weaponType,
    effect: item.effect,
    useEffects: item.useEffects,
    passiveEffects: item.passiveEffects,
    procEffects: item.procEffects,
    combatEffects: item.combatEffects
  }));

  console.log(JSON.stringify(out, null, 2));
  await client.close();
})();
