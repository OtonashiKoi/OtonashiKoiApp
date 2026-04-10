require('dotenv').config();
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs/promises');
const config = require('../src/config');
const { calcStats } = require('../src/services/monster/monsterService');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || null;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

async function loadFromJSON(){
  const p = path.resolve(config.storage.jsonDataPath);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.monsters) ? data.monsters : [];
}

async function main(){
  const argv = process.argv.slice(2);
  const doIt = argv.includes('--yes');

  let monsters = [];
  let usingMongo = false;
  let client = null;

  if (MONGO_URI) {
    try {
      client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(DB_NAME);
      const col = db.collection('monsters');
      monsters = await col.find({}).toArray();
      usingMongo = true;
    } catch (e) {
      console.warn('MongoDB unavailable, falling back to JSON store');
      if (client) await client.close();
      monsters = await loadFromJSON();
      usingMongo = false;
    }
  } else {
    monsters = await loadFromJSON();
  }

  if (!monsters.length) { console.log('No monsters found'); if (client) await client.close(); return; }

  const changes = [];
  for (const m of monsters){
    const calc = calcStats(m);
    const newExp = Math.round(calc.maxHp * 0.6);
    const newGold = Math.round(calc.maxHp * 0.5);
    const oldExp = Number(m.expReward) || 0;
    const oldGold = Number(m.goldReward) || 0;
    if (oldExp !== newExp || oldGold !== newGold) {
      changes.push({ id: m.id, name: m.name, oldExp, oldGold, newExp, newGold });
    }
  }

  console.log(`Found ${changes.length} monsters with changed rewards (out of ${monsters.length})`);
  // show up to 50 diffs
  changes.slice(0,50).forEach(c => console.log(`${c.name} (${c.id}): EXP ${c.oldExp} -> ${c.newExp}, GOLD ${c.oldGold} -> ${c.newGold}`));

  if (!doIt) {
    console.log('\nDry-run only. To apply changes, re-run with --yes');
    if (client) await client.close();
    return;
  }

  if (usingMongo){
    const db = client.db(DB_NAME);
    const col = db.collection('monsters');
    let applied = 0;
    for (const c of changes){
      const res = await col.updateOne({ id: c.id }, { $set: { expReward: c.newExp, goldReward: c.newGold, updatedAt: new Date().toISOString() } });
      if (res.matchedCount) applied++; 
    }
    console.log(`Applied ${applied} updates to MongoDB`);
    await client.close();
  } else {
    // update JSON file
    const p = path.resolve(config.storage.jsonDataPath);
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    const byId = new Map((data.monsters||[]).map(m => [m.id, m]));
    let applied = 0;
    for (const c of changes){
      const m = byId.get(c.id);
      if (m){ m.expReward = c.newExp; m.goldReward = c.newGold; m.updatedAt = new Date().toISOString(); applied++; }
    }
    data.monsters = Array.from(byId.values());
    await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Applied ${applied} updates to JSON store at ${p}`);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
