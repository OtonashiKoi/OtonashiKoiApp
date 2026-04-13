const { MongoClient } = require('mongodb');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

(async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'equipment_game';
  if (!uri) {
    console.error('MONGODB_URI not set in environment');
    process.exit(1);
  }

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const db = client.db(dbName);

  const progressColl = db.collection('progress');
  const walletsColl = db.collection('wallets');
  const playersColl = db.collection('players');

  const progressDocs = await progressColl.find({}).sort({ level: -1, exp: -1, updatedAt: -1 }).toArray();

  const playerIds = [...new Set(progressDocs.map(p => p.playerId))];

  const wallets = await walletsColl.find({ playerId: { $in: playerIds } }).toArray();
  const players = await playersColl.find({ discordId: { $in: playerIds } }).toArray();

  const walletMap = new Map(wallets.map(w => [w.playerId, w]));
  const playerMap = new Map(players.map(p => [p.discordId, p]));

  const rows = [];
  rows.push(['名稱','等級','金幣','背包數量','更新時間'].join(','));

  for (const doc of progressDocs) {
    const id = doc.playerId;
    const player = playerMap.get(id);
    const wallet = walletMap.get(id);
    const displayName = player && player.displayName ? player.displayName : id;
    const gold = wallet && typeof wallet.gold === 'number' ? wallet.gold : 0;
    const inventoryCount = Array.isArray(doc.inventory) ? doc.inventory.length : 0;
    const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : '';
    const safeName = `"${String(displayName).replace(/"/g, '""')}"`;
    rows.push([safeName, doc.level, gold, inventoryCount, updatedAt].join(','));
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '..', 'exports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `players_detailed_${ts}.csv`);
  fs.writeFileSync(outPath, rows.join('\n'));
  console.log('Wrote', outPath);

  await client.close();
})();
