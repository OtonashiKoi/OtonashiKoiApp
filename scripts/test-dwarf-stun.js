#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { calcPlayerStats } = require('../src/shared/combatStats');
const { runCombatLoop } = require('../src/shared/combatLoop');

async function fetchItem(client, query) {
  const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');
  const col = db.collection('items');
  return await col.findOne(query);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  let client = null;
  try {
    if (!uri) throw new Error('MONGODB_URI 未設定於 .env');
    client = new MongoClient(uri, { useUnifiedTopology: true });
    await client.connect();

    const job = await fetchItem(client, { id: 'job_dwarf_warrior_v1' });
    const mace2h = await fetchItem(client, { weaponType: 'mace_2h' });

    const fakeMace2h = mace2h || { id: 'fake_mace2h', name: '雙手錘(測試)', weaponType: 'mace_2h', equipSlot: 'weapon', equipStats: {} };
    const jobObj = job || { id: 'fake_dwarf', name: '矮人戰士(測試)', equipSlot: 'job_eq', equipStats: {}, combatEffects: [] };

    console.log('開始矮人戰士高血暈眩模擬（各 500 次）...');
    const TRIALS = 500;
    const mHpInit = 1000;
    const monster = { def: 0, dodge: 0, atk: 10, hit: 100 };

    // 情境：裝備雙手錘，帶上/不帶上矮人職業
    const equippedWithJob = { weapon: fakeMace2h, job: jobObj };
    const pWith = calcPlayerStats({ str: 12, agi: 5, vit: 12, int: 1, dex: 5, luk: 5 }, equippedWithJob, []);

    const equippedNoJob = { weapon: fakeMace2h };
    const pNo = calcPlayerStats({ str: 12, agi: 5, vit: 12, int: 1, dex: 5, luk: 5 }, equippedNoJob, []);

    let stunWith = 0, stunNo = 0;
    for (let i = 0; i < TRIALS; i++) {
      const res = runCombatLoop({ ...pWith }, monster, 'Dummy', mHpInit, 5, { equipped: equippedWithJob, inventory: [] });
      const joined = (res.roundLogs || []).join('\n');
      if (joined.includes('擊暈') || joined.includes('眩暈')) stunWith++;
    }

    for (let i = 0; i < TRIALS; i++) {
      const res = runCombatLoop({ ...pNo }, monster, 'Dummy', mHpInit, 5, { equipped: equippedNoJob, inventory: [] });
      const joined = (res.roundLogs || []).join('\n');
      if (joined.includes('擊暈') || joined.includes('眩暈')) stunNo++;
    }

    console.log('\n結果：');
    console.log(` - 裝備矮人戰士（雙手錘）時暈眩發生 ${stunWith}/${TRIALS} 次 (${((stunWith/TRIALS)*100).toFixed(2)}%)`);
    console.log(` - 無職業時暈眩發生 ${stunNo}/${TRIALS} 次 (${((stunNo/TRIALS)*100).toFixed(2)}%)`);

    await client.close();
  } catch (err) {
    console.error('測試發生錯誤：', err);
    if (client) await client.close();
  }
}

main();
