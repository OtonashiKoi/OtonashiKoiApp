#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function fetchItem(client, query) {
  const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');
  const col = db.collection('items');
  return await col.findOne(query);
}

const { runCombatLoop } = require('../src/shared/combatLoop');
const { calcPlayerStats } = require('../src/shared/combatStats');
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return console.error('MONGODB_URI 未設定於 .env');
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  try {
    await client.connect();
    const healer = await fetchItem(client, { id: 'job_healer_v1' });
    if (!healer) return console.error('找不到 job_healer_v1，請先執行 scripts/upsert-job-healer.js');

    // 從 healer 定義中取得所有 target='party' 的效果（包含 passive / combat / proc / use）
    const allEffects = [
      ...(healer.passiveEffects || []),
      ...(healer.combatEffects || []),
      ...(healer.procEffects || []),
      ...(healer.useEffects || [])
    ];
    const partyEffects = allEffects.filter(e => e && e.target === 'party');
    console.log('partyEffects:', partyEffects.map(e => ({ key: e.key, params: e.params })));

    // 使用 calcPlayerStats 產生較真實的 pStats
    const attrs = { str: 5, agi: 5, vit: 10, int: 5, dex: 5, luk: 2 };
    const equipped = {};
    const inventory = [];
    const pStats = calcPlayerStats(attrs, equipped, [], inventory);

    // 用一個正常的怪物 calc
    const mCalc = { def: 5, dodge: 5, atk: 8, hit: 50 };

    console.log('\n=== 場景 A：治療師先上場（存在 partyEffects） => 後來上場的玩家應得到回復效果 ===');
    const resA = runCombatLoop(pStats, mCalc, 'TestMonster', 100, 6, { partyEffects, equipped, inventory });
    console.log('Round logs excerpt:\n', resA.roundLogs.slice(0,3).join('\n\n'));

    console.log('\n=== 場景 B：治療師不在（換裝或脫下） => 不會有 partyEffects ===');
    const resB = runCombatLoop(pStats, mCalc, 'TestMonster', 100, 6, { partyEffects: [], equipped, inventory });
    console.log('Round logs excerpt:\n', resB.roundLogs.slice(0,3).join('\n\n'));

    await client.close();
  } catch (err) {
    console.error('發生錯誤：', err);
    if (client) await client.close();
  }
}

main();
