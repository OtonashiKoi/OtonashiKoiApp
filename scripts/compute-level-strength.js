const fs = require('fs/promises');
const path = require('path');
const config = require('../src/config');
const { calcStats } = require('../src/services/monster/monsterService');
const { MongoClient } = require('mongodb');

async function loadFromJSON(){
  const p = path.resolve(config.storage.jsonDataPath);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.monsters) ? data.monsters : [];
}

async function main(){
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || null;
  const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';
  let monsters = [];
  if (MONGO_URI){
    try{
      const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      monsters = await client.db(DB_NAME).collection('monsters').find({}).toArray();
      await client.close();
    }catch(e){
      monsters = await loadFromJSON();
    }
  } else {
    monsters = await loadFromJSON();
  }

  if (!monsters.length){ console.log('no monsters'); return; }
  const byLevel = new Map();
  for (const m of monsters){
    const lvl = Number(m.level) || 1;
    const c = calcStats(m);
    if (!byLevel.has(lvl)) byLevel.set(lvl, { count:0, sumHp:0, sumAtk:0, sumDef:0 });
    const agg = byLevel.get(lvl);
    agg.count++;
    agg.sumHp += c.maxHp;
    agg.sumAtk += c.atk;
    agg.sumDef += c.def;
  }

  const levels = Array.from(byLevel.keys()).sort((a,b)=>a-b);
  console.log('Level summary (avg calc):');
  levels.forEach(lvl => {
    const agg = byLevel.get(lvl);
    const avgHp = Math.round(agg.sumHp/agg.count);
    const avgAtk = Math.round(agg.sumAtk/agg.count);
    const avgDef = Math.round(agg.sumDef/agg.count);
    console.log(`- Level ${lvl}: monsters=${agg.count} => avgHp=${avgHp}, avgAtk=${avgAtk}, avgDef=${avgDef}`);
  });
}

main().catch(e=>{ console.error(e); process.exit(1); });
