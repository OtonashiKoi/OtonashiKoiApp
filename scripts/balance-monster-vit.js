require('dotenv').config();
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs/promises');
const config = require('../src/config');
const { calcStats } = require('../src/services/monster/monsterService');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || null;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

// Parameters: threshold fraction beyond which we consider outlier, and smoothing factor to move toward avg
const THRESHOLD = 0.5; // 50% above/below average
const SMOOTH = 0.5;    // move halfway toward average

async function loadFromJSON(){
  const p = path.resolve(config.storage.jsonDataPath);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.monsters) ? data.monsters : [];
}

function vitFromTargetHp(targetHp, expectedPlayers){
  const baseHp = Math.max(1, Math.round(targetHp / Math.max(1, expectedPlayers)));
  const vit = Math.round((baseHp - 50)/15);
  return Math.max(0, vit);
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

  // group by level and compute averages
  const byLevel = new Map();
  for (const m of monsters){
    const lvl = Number(m.level) || 1;
    const c = calcStats(m);
    if (!byLevel.has(lvl)) byLevel.set(lvl, { items: [], sumHp: 0 });
    const agg = byLevel.get(lvl);
    agg.items.push({ m, calc: c });
    agg.sumHp += c.maxHp;
  }

  const diffs = [];
  for (const [lvl, agg] of byLevel.entries()){
    const avgHp = Math.round(agg.sumHp / agg.items.length);
    for (const it of agg.items){
      const curHp = it.calc.maxHp;
      const lowBound = Math.round(avgHp * (1 - THRESHOLD));
      const highBound = Math.round(avgHp * (1 + THRESHOLD));
      let targetHp = curHp;
      if (curHp < lowBound || curHp > highBound){
        // move toward avg by SMOOTH factor
        targetHp = Math.round(avgHp + (curHp - avgHp) * SMOOTH);
      }
      if (targetHp !== curHp){
        const expectedPlayers = Number((config.game && config.game.monsterExpectedPlayers) || 6);
        const newVit = vitFromTargetHp(targetHp, expectedPlayers);
        const oldVit = Number(it.m.vit) || 0;
        if (newVit !== oldVit) diffs.push({ id: it.m.id, name: it.m.name, level: lvl, oldVit, curHp, targetHp, newVit });
      }
    }
  }

  console.log(`Found ${diffs.length} monsters to adjust VIT (out of ${monsters.length})`);
  diffs.forEach(d => console.log(`${d.name} (${d.id}) lvl${d.level}: VIT ${d.oldVit} -> ${d.newVit} (HP ${d.curHp} -> ${d.targetHp})`));

  if (!doIt){ console.log('\nDry-run only. To apply changes run with --yes'); if (client) await client.close(); return; }

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
