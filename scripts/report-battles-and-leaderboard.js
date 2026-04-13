#!/usr/bin/env node
/*
  Usage:
    node scripts/report-battles-and-leaderboard.js
  會使用專案根目錄的 .env（含 MONGODB_URI 及 MONGODB_DB_NAME）連線到 MongoDB
  輸出：./exports/battle_report_<ts>.json 及 ./exports/leaderboard_<ts>.csv
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

    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    // 1) 從 transactions 找出過去三天有 monster:* 來源的玩家
    const transactionsCol = db.collection('transactions');
    const monsterPlayers = await transactionsCol.distinct('playerId', {
      source: { $regex: '^monster:' },
      createdAt: { $gte: startDate }
    });

    // 2) 從 progress 找出過去三天有更新的玩家（可視為有經驗或等級變動的候選）
    const progressCol = db.collection('progress');
    const recentProgressPlayers = await progressCol.distinct('playerId', {
      updatedAt: { $gte: startDate }
    });

    // 交集：既有 monster 交易又在 progress 更新的玩家（更有可能是參與且有經驗值改變）
    const participatedAndExp = monsterPlayers.filter(p => recentProgressPlayers.includes(p));

    // 3) 目前整體等級排行榜（依 level desc, exp desc）
    const leaderboardCursor = progressCol.find({}, { projection: { playerId: 1, level: 1, exp: 1, updatedAt:1 } })
      .sort({ level: -1, exp: -1 });
    const leaderboard = await leaderboardCursor.toArray();

    const out = {
      ts: now.toISOString(),
      rangeStart: startDate.toISOString(),
      rangeEnd: now.toISOString(),
      monsterTransactionUniqueCount: monsterPlayers.length,
      monsterTransactionPlayers: monsterPlayers,
      recentProgressUniqueCount: recentProgressPlayers.length,
      recentProgressPlayers: recentProgressPlayers,
      participatedAndExpCount: participatedAndExp.length,
      participatedAndExpPlayers: participatedAndExp,
      leaderboardCount: leaderboard.length,
      leaderboard: leaderboard
    };

    const exportDir = path.resolve(__dirname, '..', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outJson = path.join(exportDir, `battle_report_${ts}.json`);
    fs.writeFileSync(outJson, JSON.stringify(out, null, 2), 'utf8');
    console.log('✅ Report written to', outJson);

    const csvPath = path.join(exportDir, `leaderboard_${ts}.csv`);
    const header = ['playerId','level','exp','updatedAt'].join(',');
    const lines = [header].concat((leaderboard || []).map(r => [r.playerId, r.level ?? '', r.exp ?? '', r.updatedAt ? new Date(r.updatedAt).toISOString() : ''].join(',')));
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
    console.log('✅ Leaderboard CSV written to', csvPath);

    await client.close();
    console.log('✅ Done');
  } catch (err) {
    console.error('❌ Error:', err && err.message ? err.message : err);
    try { await client.close(); } catch (_) {}
    process.exit(2);
  }
})();
