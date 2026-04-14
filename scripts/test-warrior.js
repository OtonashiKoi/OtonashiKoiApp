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

function containsAny(text, arr) {
  if (!text) return false;
  return arr.some((s) => text.includes(s));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  let client = null;
  try {
    if (!uri) throw new Error('MONGODB_URI 未設定於 .env');
    client = new MongoClient(uri, { useUnifiedTopology: true });
    await client.connect();

    // 讀取 job 與武器道具
    const job = await fetchItem(client, { id: 'job_warrior_v1' });
    const axe1 = await fetchItem(client, { weaponType: 'axe_1h' });
    const offhandAxe = await fetchItem(client, { weaponType: 'offhand_axe' });
    const shield = await fetchItem(client, { equipSlot: 'shield' });
    const axe2 = await fetchItem(client, { weaponType: 'axe_2h' });

    // fallback 簡化物件
    const fakeAxe1 = axe1 || { id: 'fake_axe1', name: '單手斧(測試)', weaponType: 'axe_1h', equipSlot: 'weapon', equipStats: {} };
    const fakeOffhand = offhandAxe || { id: 'fake_offhand', name: '副手斧(測試)', weaponType: 'offhand_axe', equipSlot: 'shield' };
    const fakeShield = shield || { id: 'fake_shield', name: '盾牌(測試)', weaponType: null, equipSlot: 'shield' };
    const fakeAxe2 = axe2 || { id: 'fake_axe2', name: '雙手斧(測試)', weaponType: 'axe_2h', equipSlot: 'weapon', equipStats: {} };
    const jobObj = job || {
      id: 'fake_warrior', name: '戰士(測試)', equipSlot: 'job_eq', equipStats: { str: 4, vit: 1, luk: 2 }, passiveEffects: []
    };

    console.log('開始戰士模擬（500 次）...');
    const TRIALS = 500;
    const mHpInit = 1000;
    const monster = { def: 0, dodge: 0, atk: 10, hit: 100 };

    // 場景 A: 單手斧 + 盾
    const equippedA = { weapon: fakeAxe1, shield: fakeShield, job: jobObj };
    const pA = calcPlayerStats({ str: 10, agi: 5, vit: 10, int: 1, dex: 5, luk: 5 }, equippedA, []);
    let blocks = 0, wins = 0, totalDamageSum = 0;
    for (let i = 0; i < TRIALS; i++) {
      const res = runCombatLoop({ ...pA }, monster, 'Dummy', mHpInit, 5, { equipped: equippedA, inventory: [] });
      const log = (res.roundLogs || []).join('\n');
      if (log.includes('格擋')) blocks++;
      if (res.outcome === 'win') wins++;
      totalDamageSum += res.totalDamage;
    }
    console.log('\n場景 A: 單手斧 + 盾');
    console.log(' - pStats.atk:', pA.atk, ' comboDamageMultiplier:', pA.comboDamageMultiplier, ' blockChance:', pA.blockChance);
    console.log(` - 格擋發生 ${blocks}/${TRIALS} 次 (${((blocks/TRIALS)*100).toFixed(2)}%)`);
    console.log(` - 勝利 ${wins}/${TRIALS}`);
    console.log(' - 平均總傷害:', (totalDamageSum / TRIALS).toFixed(2));

    // 場景 B: 單手斧 + 副手武器
    const equippedB = { weapon: fakeAxe1, shield: fakeOffhand, job: jobObj };
    const pB = calcPlayerStats({ str: 10, agi: 8, vit: 10, int: 1, dex: 5, luk: 5 }, equippedB, []);
    let comboHits = 0; wins = 0; totalDamageSum = 0;
    for (let i = 0; i < TRIALS; i++) {
      const res = runCombatLoop({ ...pB }, monster, 'Dummy', mHpInit, 5, { equipped: equippedB, inventory: [] });
      const log = (res.roundLogs || []).join('\n');
      if (containsAny(log, ['連擊', '追加攻擊'])) comboHits++;
      if (res.outcome === 'win') wins++;
      totalDamageSum += res.totalDamage;
    }
    console.log('\n場景 B: 單手斧 + 副手武器');
    console.log(' - pStats.atk:', pB.atk, ' comboDamageMultiplier:', pB.comboDamageMultiplier, ' combo%:', pB.combo);
    console.log(` - 觸發連擊 ${comboHits}/${TRIALS} 次 (${((comboHits/TRIALS)*100).toFixed(2)}%)`);
    console.log(` - 勝利 ${wins}/${TRIALS}`);
    console.log(' - 平均總傷害:', (totalDamageSum / TRIALS).toFixed(2));

    // 場景 C: 雙手斧（檢查暴擊率與低血加成）
    const equippedC = { weapon: fakeAxe2, job: jobObj };
    const pC = calcPlayerStats({ str: 10, agi: 5, vit: 10, int: 1, dex: 5, luk: 5 }, equippedC, []);
    // 檢視基礎 crit
    console.log('\n場景 C: 雙手斧（基礎）');
    console.log(' - pStats.atk:', pC.atk, ' crit%:', pC.crit);

    // C1: 普通情況
    let critCount = 0; wins = 0; totalDamageSum = 0;
    for (let i = 0; i < TRIALS; i++) {
      const res = runCombatLoop({ ...pC }, monster, 'Dummy', mHpInit, 5, { equipped: equippedC, inventory: [] });
      const log = (res.roundLogs || []).join('\n');
      if (containsAny(log, ['會心', '致命', '弱點', '完美'])) critCount++;
      if (res.outcome === 'win') wins++;
      totalDamageSum += res.totalDamage;
    }
    console.log(' - 普通：爆擊出現', critCount, `次 (${((critCount/TRIALS)*100).toFixed(2)}%)，平均總傷害:`, (totalDamageSum/TRIALS).toFixed(2));

    // C2: 模擬低血（將玩家輸出乘上 1.15）
    let critCountLow = 0; wins = 0; let totalDamageLow = 0;
    const pC_low = { ...pC, atk: Math.round(pC.atk * 1.15) };
    for (let i = 0; i < TRIALS; i++) {
      const res = runCombatLoop({ ...pC_low }, monster, 'Dummy', mHpInit, 5, { equipped: equippedC, inventory: [] });
      const log = (res.roundLogs || []).join('\n');
      if (containsAny(log, ['會心', '致命', '弱點', '完美'])) critCountLow++;
      if (res.outcome === 'win') wins++;
      totalDamageLow += res.totalDamage;
    }
    console.log(' - 低血模擬（傷害+15%）：爆擊', critCountLow, `次 (${((critCountLow/TRIALS)*100).toFixed(2)}%)，平均總傷害:`, (totalDamageLow/TRIALS).toFixed(2));

    await client.close();
  } catch (err) {
    console.error('發生錯誤：', err);
    if (client) await client.close();
  }
}

main();
