/*
  Usage:
    node scripts/export-monster-participants.js
  要求：在專案根目錄有 .env，其中包含 MONGODB_URI 與 MONGODB_DB_NAME
  輸出：./exports/monster_participants_<timestamp>.xlsx
*/

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// try to load .env if present (non-fatal)
try { require('dotenv').config(); } catch (e) {}

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'equipment_game';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment. Please set it in .env or env.');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    const db = client.db(MONGODB_DB_NAME);

    const monsterStateCol = db.collection('monsterState');
    const playersCol = db.collection('players');
    const progressCol = db.collection('progress');
    const walletsCol = db.collection('wallets');

    const zones = ['normal', 'mid'];
    const rows = [];

    for (const zone of zones) {
      const doc = await monsterStateCol.findOne({ _id: zone });
      const state = (doc && doc.value) ? doc.value : null;
      if (!state) continue;
      const participants = Array.isArray(state.participants) ? state.participants : [];
      const damageMap = state.damageMap || {};

      for (const pid of participants) {
        // attempt to resolve player info from players / progress
        const player = await playersCol.findOne({ discordId: pid }).catch(() => null);
        const prog = await progressCol.findOne({ playerId: pid }).catch(() => null);
        const wallet = await walletsCol.findOne({ playerId: pid }).catch(() => null);

        const displayName = (player && (player.displayName || player.name)) || (prog && (prog.displayName || prog.name)) || (damageMap[pid] && damageMap[pid].name) || '';
        const level = (prog && (prog.level ?? prog?.progress?.level)) || '';
        const gold = wallet ? (wallet.gold ?? '') : '';
        const damage = (damageMap[pid] && (damageMap[pid].damage || 0)) || 0;
        const updatedAt = (prog && prog.updatedAt) || (player && player.updatedAt) || '';

        rows.push({
          區域: zone === 'mid' ? '中級區' : '一般區',
          DiscordID: pid,
          名稱: displayName,
          等級: level,
          總傷害: damage,
          金幣: gold,
          更新時間: updatedAt || '',
          備註: ''
        });
      }
    }

    // Also dedupe by DiscordID (in case same id appears in multiple zones)
    const map = new Map();
    for (const r of rows) map.set(r.DiscordID, r);
    const finalRows = Array.from(map.values());

    // produce xlsx via built-in minimal CSV fallback if xlsx module not available
    const exportDir = path.resolve(__dirname, '..', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outXlsx = path.join(exportDir, `monster_participants_${ts}.xlsx`);
    const outCsv = path.join(exportDir, `monster_participants_${ts}.csv`);

    let usedXlsx = false;
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(finalRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '參加者');
      XLSX.writeFile(wb, outXlsx);
      console.log('✅ Excel exported to', outXlsx);
      usedXlsx = true;
    } catch (e) {
      // fallback to CSV
      console.warn('⚠️ xlsx module not found, falling back to CSV. To produce .xlsx install `npm install xlsx`');
      const header = Object.keys(finalRows[0] || { 區域: '', DiscordID: '', 名稱: '', 等級: '', 總傷害: '', 金幣: '', 更新時間: '', 備註: '' });
      const lines = [header.join(',')].concat(finalRows.map(r => header.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(',')));
      fs.writeFileSync(outCsv, lines.join('\n'), 'utf8');
      console.log('✅ CSV exported to', outCsv);
    }

    await client.close();
    console.log('✅ Done');
    if (!usedXlsx) console.log('如需 Excel 檔請執行：npm install xlsx 然後重新執行腳本');
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    try { await client.close(); } catch (_) {}
    process.exit(2);
  }
})();
