require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs/promises');
const path = require('path');
const config = require('../src/config');

async function loadFromJSON(){
  const p = path.resolve(config.storage.jsonDataPath);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.monsters) ? data.monsters : [];
}

async function main(name){
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || null;
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';
  let mongoMonster = null;
  if (MONGO_URI){
    try{
      const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      mongoMonster = await client.db(DB_NAME).collection('monsters').findOne({ name });
      await client.close();
    }catch(e){ console.warn('Mongo unavailable, skipping'); }
  }

  const monsters = await loadFromJSON();
  const jsonMonster = monsters.find(m => m.name === name || (m.name||'').includes(name));

  console.log('--- JSON store ---');
  if (jsonMonster) console.log(JSON.stringify(jsonMonster, null, 2)); else console.log('not found');
  console.log('\n--- Mongo store ---');
  if (mongoMonster) console.log(JSON.stringify(mongoMonster, null, 2)); else console.log('not found');
}

const name = process.argv[2] || '小史';
main(name).catch(e=>{ console.error(e); process.exit(1); });
