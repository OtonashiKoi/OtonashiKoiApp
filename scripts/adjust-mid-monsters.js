// scripts/adjust-mid-monsters.js
// 將 zone='mid' 的 monsters 的 entryFee / expReward / goldReward 乘上調整係數並寫回雲端
"use strict";
require('dotenv').config();
const { MongoClient } = require('mongodb');

const FACTOR = 0.6; // 調整係數，可修改

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const DB = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || 'equipment_game';
  if (!MONGODB_URI) { console.error('Please set MONGODB_URI in .env'); process.exit(2); }
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(DB);
  const coll = db.collection('monsters');

  const mid = await coll.find({ zone: 'mid' }).toArray();
  if (!mid.length) { console.log('No mid-zone monsters found.'); await client.close(); return; }

  console.log(`Found ${mid.length} mid-zone monsters. Applying factor ${FACTOR}...`);
  const changes = [];
  for (const m of mid) {
    const oldEntry = Number(m.entryFee || 0);
    const oldExp = Number(m.expReward || 0);
    const oldGold = Number(m.goldReward || 0);

    const newEntry = Math.max(1, Math.round(oldEntry * FACTOR));
    const newExp = Math.max(0, Math.round(oldExp * FACTOR));
    const newGold = Math.max(0, Math.round(oldGold * FACTOR));

    await coll.updateOne({ id: m.id }, { $set: { entryFee: newEntry, expReward: newExp, goldReward: newGold } });
    changes.push({ id: m.id, name: m.name, level: m.level, before: { entryFee: oldEntry, exp: oldExp, gold: oldGold }, after: { entryFee: newEntry, exp: newExp, gold: newGold } });
    console.log(`Updated ${m.name} (${m.id}): entry ${oldEntry}->${newEntry}, exp ${oldExp}->${newExp}, gold ${oldGold}->${newGold}`);
  }

  console.log('\nSummary:');
  console.log(JSON.stringify(changes, null, 2));
  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
