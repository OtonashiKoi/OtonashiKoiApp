#!/usr/bin/env node
/**
 * 測試斬殺是否在戰鬥迴圈觸發並量測觸發率
 *
 * 使用方式：在專案根目錄執行 `node scripts/test-execute.js`
 */
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

    // 盡量從 DB 讀出 job 與 一把雙手劍；若找不到則退回至簡單 fallback
    let job = await fetchItem(client, { id: 'job_swordsman_v1' });
    if (!job) job = await fetchItem(client, { equipSlot: 'job_eq' });
    let sword2h = await fetchItem(client, { weaponType: 'sword_2h' });
    if (!sword2h) sword2h = await fetchItem(client, { name: /雙手劍|2h|two hand/i });

    if (!job) console.warn('找不到 job item（job_swordsman_v1），將用簡化模擬。');
    if (!sword2h) console.warn('找不到 sword_2h，道具將以簡化欄位模擬。');

    // 準備 equipped 物件（effectEngine 會檢查 item.passiveEffects）
    const equipped = {
      weapon: sword2h || { id: 'fake_sword_2h', name: '雙手劍(測試)', weaponType: 'sword_2h', equipStats: { str: 0 } },
      job: job || { id: 'fake_job', name: '劍士(測試)', equipSlot: 'job_eq', passiveEffects: [
        { key: 'execute_chance_up', trigger: 'passive', params: { value: 10 }, condition: { weaponType: 'sword_2h' } },
        { key: 'execute_threshold_up', trigger: 'passive', params: { value: 10 }, condition: { weaponType: 'sword_2h' } }
      ] }
    };

    // 基本屬性（隨意，重點是被動效果）
    const baseAttrs = { str: 10, agi: 5, vit: 10, int: 1, dex: 5, luk: 5 };

    // 計算玩家戰鬥數值
    const pStats = calcPlayerStats(baseAttrs, equipped, []);

    // 為了穩定測試：把第一擊傷害定為會把怪物血量降到門檻內但不直接殺死
    // 設定模擬怪物初始 HP = 1000，門檻若為10% => thresholdHp = 100
    const mHpInit = 1000;

    // 調整 pStats 使第一擊傷害落在 1..thresholdHp 範圍
    const thresholdHp = Math.max(1, Math.floor(mHpInit * (pStats.executeThresholdPct / 100)));
    if (thresholdHp <= 0) {
      console.warn('player 統計顯示 executeThresholdPct =', pStats.executeThresholdPct, '無法測試斬殺條件');
      return;
    }

    // 我們希望第一擊後怪物剩餘 HP 在 1..thresholdHp
    // 設定 pStats.atk = mHpInit - targetRemaining（取中間值）
    const targetRemaining = Math.max(1, Math.floor(thresholdHp / 2));
    // 直接強制 atk 與傷害浮動為固定值以避免隨機影響
    pStats.atk = Math.max(1, mHpInit - targetRemaining);
    pStats.dmgMin = 1;
    pStats.dmgMax = 1;

    console.log('測試設定：');
    console.log(' - executeChance:', pStats.executeChance);
    console.log(' - executeThresholdPct:', pStats.executeThresholdPct, '% => thresholdHp =', thresholdHp);
    console.log(' - 強制 pStats.atk =', pStats.atk, '（讓第一擊後剩', targetRemaining, 'HP）');

    const TRIALS = 500;
    let execCount = 0;
    let winCount = 0;

    for (let i = 0; i < TRIALS; i++) {
      const mCalc = { def: 0, dodge: 0, hit: 100, atk: 0 }; // 簡化怪物數值
      const res = runCombatLoop(pStats, mCalc, 'TestDummy', mHpInit, 5, { equipped, inventory: [] });
      // 檢查回合日誌是否有斬殺觸發字串
      const hadExecute = (res.roundLogs || []).some((r) => r.includes('斬殺觸發'));
      if (hadExecute) execCount++;
      if (res.outcome === 'win') winCount++;
    }

    console.log(`執行 ${TRIALS} 次模擬：斬殺觸發 ${execCount} 次（${((execCount / TRIALS) * 100).toFixed(2)}%），勝利 ${winCount} 次。`);

  } catch (err) {
    console.error('發生錯誤：', err);
  } finally {
    if (client) await client.close();
  }
}

main();
