/*
  Usage:
    node scripts/export-all-players.js
  要求：在專案根目錄有 .env，其中包含 MONGODB_URI 與 MONGODB_DB_NAME
  輸出：./exports/all_players_<timestamp>.xlsx
*/

const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch (e) {}
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'equipment_game';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment.');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    const db = client.db(MONGODB_DB_NAME);

    const playersCol = db.collection('players');
    const progressCol = db.collection('progress');
    const walletsCol = db.collection('wallets');

    const players = await playersCol.find({}).toArray();

    const rows = [];
    for (const p of players) {
      const discordId = p.discordId || '';
      const progress = await progressCol.findOne({ playerId: discordId }).catch(() => null) || {};
      const wallet = await walletsCol.findOne({ playerId: discordId }).catch(() => null) || {};

      const displayName = p.displayName || p.name || progress.displayName || progress.name || '';
      const level = (progress.level ?? progress.progress?.level) || '';
      const gold = wallet.gold ?? '';
      const inventoryCount = Array.isArray(progress.inventory) ? progress.inventory.length : '';
      const lastUpdated = progress.updatedAt || p.updatedAt || '';
      const externalIds = p.externalIds ? JSON.stringify(p.externalIds) : '';

      rows.push({
        DiscordID: discordId,
        名稱: displayName,
        等級: level,
        金幣: gold,
        背包數量: inventoryCount,
        外部ID: externalIds,
        更新時間: lastUpdated,
        備註: ''
      });
    }

    const exportDir = path.resolve(__dirname, '..', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outXlsx = path.join(exportDir, `all_players_${ts}.xlsx`);
    const outCsv = path.join(exportDir, `all_players_${ts}.csv`);

    let usedXlsx = false;
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '玩家');
      XLSX.writeFile(wb, outXlsx);
      console.log('✅ Excel exported to', outXlsx);
      usedXlsx = true;
    } catch (e) {
      console.warn('⚠️ xlsx module not found, falling back to CSV.');
      const header = Object.keys(rows[0] || { DiscordID: '', 名稱: '', 等級: '', 金幣: '', 背包數量: '', 外部ID: '', 更新時間: '', 備註: '' });
      const lines = [header.join(',')].concat(rows.map(r => header.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(',')));
      fs.writeFileSync(outCsv, lines.join('\n'), 'utf8');
      console.log('✅ CSV exported to', outCsv);
    }

    await client.close();
    console.log('✅ Done');
    if (!usedXlsx) console.log('如需 Excel 檔請安裝 xlsx：npm install xlsx 並重試');
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    try { await client.close(); } catch (_) {}
    process.exit(2);
  }
})();
