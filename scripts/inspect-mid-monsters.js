// scripts/inspect-mid-monsters.js
// 從雲端 MongoDB 讀取 monsters collection，統計 zone='mid' 的 entryFee / expReward / goldReward
"use strict";
require('dotenv').config();
const { MongoClient } = require('mongodb');

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

  const stats = { count: mid.length, entryFee: [], exp: [], gold: [] };
  for (const m of mid) {
    stats.entryFee.push(Number(m.entryFee || 0));
    stats.exp.push(Number(m.expReward || 0));
    stats.gold.push(Number(m.goldReward || 0));
  }

  const summarize = (arr) => {
    const n = arr.length;
    const sum = arr.reduce((s, v) => s + v, 0);
    const avg = sum / n;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const sorted = [...arr].sort((a,b)=>a-b);
    const median = sorted[Math.floor(n/2)];
    return { n, sum, avg: Math.round(avg*100)/100, min, max, median };
  };

  console.log('Mid-zone monsters:', stats.count);
  console.log('EntryFee:', summarize(stats.entryFee));
  console.log('EXP reward:', summarize(stats.exp));
  console.log('Gold reward:', summarize(stats.gold));

  const topExp = mid.slice().sort((a,b)=> (b.expReward||0)-(a.expReward||0)).slice(0,10).map(m=>({ id: m.id, name: m.name, level: m.level, exp: m.expReward, gold: m.goldReward, entryFee: m.entryFee }));
  console.log('\nTop 10 by EXP:');
  console.log(JSON.stringify(topExp, null, 2));

  await client.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
