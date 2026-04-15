#!/usr/bin/env node
const { MongoClient } = require('mongodb');

// Usage:
// MONGO_URL="mongodb://..." node scripts/check-monster-drops.js all
// MONGO_URL="..." node scripts/check-monster-drops.js --monster=MONSTER_ID
// Options: --json (output machine-friendly JSON), --limit=N

const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/equipmentgame';

function parseArgs() {
  const raw = process.argv.slice(2);
  const opts = { monsterId: null, json: false, limit: null, all: false };
  for (const t of raw) {
    if (t === 'all' || t === '--all') opts.all = true;
    else if (t === '--json') opts.json = true;
    else if (t.startsWith('--monster=')) opts.monsterId = t.split('=')[1];
    else if (t.startsWith('--limit=')) opts.limit = parseInt(t.split('=')[1], 10) || null;
    else if (!t.startsWith('--') && !opts.monsterId) opts.monsterId = t;
  }
  if (!opts.all && !opts.monsterId) opts.all = true;
  return opts;
}

function extractItemIdsFromMonster(monster) {
  const ids = new Set();

  function add(val) {
    if (val == null) return;
    if (typeof val === 'string') {
      // support paths like '/items/sword_001' or 'items/sword_001'
      const parts = val.split('/').filter(Boolean);
      const candidate = parts.length ? parts[parts.length - 1] : val;
      ids.add(candidate);
      return;
    }
    if (typeof val === 'number') {
      ids.add(String(val));
      return;
    }
    if (Array.isArray(val)) {
      for (const e of val) add(e);
      return;
    }
    if (typeof val === 'object') {
      if (val.id) ids.add(val.id);
      else if (val.itemId) ids.add(val.itemId);
      else if (val.item) ids.add(val.item);
      else if (val._id) ids.add(String(val._id));
      else {
        // try to find any string-like fields
        for (const k of Object.keys(val)) {
          add(val[k]);
        }
      }
      return;
    }
  }

  const candidateFields = ['drops', 'dropTable', 'loot', 'dropList', 'dropItems', 'rewards', 'rewardItems'];
  for (const f of candidateFields) {
    if (monster[f]) add(monster[f]);
  }

  // fallback: scan top-level strings that contain '/'
  for (const k of Object.keys(monster)) {
    const v = monster[k];
    if (typeof v === 'string' && v.includes('/')) add(v);
  }

  return Array.from(ids).filter(Boolean);
}

async function main() {
  const opts = parseArgs();
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db();
    const monstersCol = db.collection('monsters');
    const itemsCol = db.collection('items');

    const q = opts.monsterId ? { id: opts.monsterId } : {};
    const cursor = monstersCol.find(q, { projection: { id: 1, name: 1 } });

    const monsterMap = [];
    let processed = 0;
    const allItemIds = new Set();

    while (await cursor.hasNext()) {
      const m = await cursor.next();
      if (!m) continue;
      // fetch full doc to inspect drop fields
      const full = await monstersCol.findOne({ id: m.id });
      const ids = extractItemIdsFromMonster(full || m);
      ids.forEach((x) => allItemIds.add(x));
      monsterMap.push({ id: m.id, name: m.name || null, ids });
      processed += 1;
      if (opts.limit && processed >= opts.limit) break;
    }

    const allIds = Array.from(allItemIds).filter(Boolean);
    const foundDocs = allIds.length
      ? await itemsCol.find({ id: { $in: allIds } }, { projection: { id: 1 } }).toArray()
      : [];
    const foundSet = new Set(foundDocs.map((d) => d.id));

    const result = { checkedMonsters: monsterMap.length, missingByMonster: {}, missingTotals: [] };
    const missingTotalsSet = new Set();

    for (const m of monsterMap) {
      const missing = m.ids.filter((i) => !foundSet.has(i));
      if (missing.length) {
        result.missingByMonster[m.id] = { name: m.name, missing };
        missing.forEach((x) => missingTotalsSet.add(x));
      }
    }

    result.missingTotals = Array.from(missingTotalsSet);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Checked monsters: ${result.checkedMonsters}`);
      if (result.missingTotals.length === 0) {
        console.log('All referenced drop items exist in `items` collection.');
      } else {
        console.log(`Missing ${result.missingTotals.length} unique item ids:`);
        console.log(result.missingTotals.join(', '));
        console.log('\nDetails by monster:');
        for (const [mid, info] of Object.entries(result.missingByMonster)) {
          console.log(`- ${info.name || mid} (${mid}): ${info.missing.join(', ')}`);
        }
      }
    }

    // exit code 0 if no missing, 2 if missing items found
    process.exitCode = result.missingTotals.length ? 2 : 0;
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 1;
  } finally {
    try {
      await client.close();
    } catch (e) {}
  }
}

main();
