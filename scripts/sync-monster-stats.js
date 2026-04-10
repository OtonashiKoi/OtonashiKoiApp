/**
 * sync-monster-stats.js
 * 將 game.json 的怪物資料完整同步到 MongoDB（upsert by id）
 * 用法：
 *   node scripts/sync-monster-stats.js          （dry-run，只印出差異）
 *   node scripts/sync-monster-stats.js --yes     （實際寫入）
 */
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const config = require('../src/config');
const { MongoClient } = require('mongodb');

const FIELDS_TO_SYNC = [
  'name','seq','zone','level',
  'str','agi','vit','int','dex','luk',
  'maxHp','def',
  'entryFee','expReward','goldReward',
  'drops','spawnRate','isBoss','enabled',
  'imageUrl','imageThumbnailUrl'
];

async function run() {
  const doIt = process.argv.includes('--yes');

  const jsonPath = path.resolve(config.storage.jsonDataPath);
  const raw  = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  const localMonsters = Array.isArray(data.monsters) ? data.monsters : [];
  console.log(`Local: ${localMonsters.length} monsters in ${jsonPath}`);

  const uri    = config.storage.mongoUri || process.env.MONGODB_URI;
  const dbName = config.storage.mongoDbName || process.env.MONGODB_DB_NAME || 'equipment_game';
  if (!uri) throw new Error('No MongoDB URI — set MONGODB_URI in .env');

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(dbName).collection('monsters');

  const remoteAll  = await col.find().toArray();
  const remoteById = Object.fromEntries(remoteAll.map(m => [m.id, m]));

  const toUpsert = [];
  const toDelete = [];

  // 找出需要 upsert 的（本地有，遠端沒有或數值不同）
  for (const m of localMonsters) {
    const remote = remoteById[m.id];
    const changed = !remote || FIELDS_TO_SYNC.some(f => JSON.stringify(m[f]) !== JSON.stringify(remote[f]));
    if (changed) toUpsert.push(m);
  }

  // 找出遠端多餘的（本地已刪除）
  const localIds = new Set(localMonsters.map(m => m.id));
  for (const r of remoteAll) {
    if (!localIds.has(r.id)) toDelete.push(r);
  }

  console.log(`Will upsert: ${toUpsert.length}, delete: ${toDelete.length}`);
  if (!doIt) {
    console.log('Dry-run. Rerun with --yes to write.\nUpsert preview:');
    toUpsert.forEach(m => console.log(' ', m.zone, m.seq, m.name, 'HP:'+m.maxHp, 'DEF:'+m.def+'%', 'exp:'+m.expReward));
    if (toDelete.length) console.log('Delete:', toDelete.map(m => m.name));
    await client.close();
    return;
  }

  const now = new Date().toISOString();
  for (const m of toUpsert) {
    const patch = {};
    FIELDS_TO_SYNC.forEach(f => { patch[f] = m[f] ?? null; });
    patch.updatedAt = now;
    await col.updateOne({ id: m.id }, { $set: patch }, { upsert: true });
    console.log(' upserted:', m.zone, m.seq, m.name);
  }
  for (const m of toDelete) {
    await col.deleteOne({ id: m.id });
    console.log(' deleted:', m.name);
  }

  console.log('Done.');
  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
