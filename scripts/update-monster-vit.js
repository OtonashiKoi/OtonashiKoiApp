require('dotenv').config();
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs/promises');
const config = require('../src/config');

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

  if (MONGO_URI){
    try{
      client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db(DB_NAME);
      monsters = await db.collection('monsters').find({}).toArray();
      usingMongo = true;
    }catch(e){
      if (client) await client.close();
      monsters = await loadFromJSON();
      usingMongo = false;
    }
  } else {
    monsters = await loadFromJSON();
  }

  if (!monsters.length){ console.log('No monsters found'); if (client) await client.close(); return; }

  const diffs = [];
  for (const m of monsters){
    const oldVit = Number(m.vit) || 0;
    const newVit = Math.round(oldVit * 2);
    if (oldVit !== newVit) diffs.push({ id: m.id, name: m.name, oldVit, newVit });
  }

  console.log(`Found ${diffs.length} monsters to update (out of ${monsters.length})`);
  diffs.slice(0,100).forEach(d => console.log(`${d.name} (${d.id}): VIT ${d.oldVit} -> ${d.newVit}`));

  if (!doIt){ console.log('\nDry-run only. To apply run with --yes'); if (client) await client.close(); return; }

  if (usingMongo){
    const db = client.db(DB_NAME);
    let applied = 0;
    for (const d of diffs){
      const res = await db.collection('monsters').updateOne({ id: d.id }, { $set: { vit: d.newVit, updatedAt: new Date().toISOString() } });
      if (res.matchedCount) applied++;
    }
    console.log(`Applied ${applied} updates to MongoDB`);
    await client.close();
  } else {
    const p = path.resolve(config.storage.jsonDataPath);
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    const byId = new Map((data.monsters||[]).map(m => [m.id, m]));
    let applied = 0;
    for (const d of diffs){
      const m = byId.get(d.id);
      if (m){ m.vit = d.newVit; m.updatedAt = new Date().toISOString(); applied++; }
    }
    data.monsters = Array.from(byId.values());
    await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Applied ${applied} updates to JSON store at ${p}`);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
