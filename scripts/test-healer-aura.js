#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function fetchItem(client, query) {
  const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');
  const col = db.collection('items');
  return await col.findOne(query);
}

const { runCombatLoop } = require('../src/shared/combatLoop');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return console.error('MONGODB_URI 未設定於 .env');
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  try {
    await client.connect();
    const healer = await fetchItem(client, { id: 'job_healer_v1' });
    if (!healer) return console.error('找不到 job_healer_v1，請先執行 scripts/upsert-job-healer.js');

    // 從 healer 裝備直接取得 party effect
    const partyEffects = (healer.passiveEffects || []).filter(e => e.target === 'party');
    console.log('partyEffects:', partyEffects.map(e => ({ key: e.key, params: e.params })));

    // 簡單 pStats 範例（只要提供 combatLoop 所需的欄位）
    const pStatsTemplate = (maxHp) => ({
      maxHp,
      dmgMin: 1.0,
      dmgMax: 1.25,
      atk: 10,
      hit: 80,
      dodge: 5,
      armorBreakChance: 0,
      bypassMonsterDefPct: 0,
      isDualWield: false,
      combo: 0,
      comboDamageMultiplier: 1,
      crit: 0,
      stunChance: 0,
      executeChance: 0,
      executeThresholdPct: 0
    });

    const mCalc = { def: 5, dodge: 5, atk: 8, hit: 50, calc: { maxHp: 200 } };

    console.log('\n=== 場景 A：治療師先上場（存在 partyEffects） => 後來上場的玩家應得到回復效果 ===');
    const allyP = pStatsTemplate(200);
    const resA = runCombatLoop(allyP, mCalc, 'TestMonster', 100, 6, { partyEffects });
    console.log('Round logs excerpt:\n', resA.roundLogs.slice(0,3).join('\n\n'));

    console.log('\n=== 場景 B：治療師不在（換裝或脫下） => 不會有 partyEffects ===');
    const resB = runCombatLoop(allyP, mCalc, 'TestMonster', 100, 6, { partyEffects: [] });
    console.log('Round logs excerpt:\n', resB.roundLogs.slice(0,3).join('\n\n'));

    await client.close();
  } catch (err) {
    console.error('發生錯誤：', err);
    if (client) await client.close();
  }
}

main();
