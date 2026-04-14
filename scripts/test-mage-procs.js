#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function fetchItem(client, query) {
  const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');
  const col = db.collection('items');
  return await col.findOne(query);
}

function collectProcs(job) {
  const arr = [];
  if (job && Array.isArray(job.procEffects)) arr.push(...job.procEffects);
  if (job && Array.isArray(job.combatEffects)) arr.push(...job.combatEffects);
  return arr;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return console.error('MONGODB_URI 未設定於 .env');
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  try {
    await client.connect();
    const job = await fetchItem(client, { id: 'job_mage_v1' });
    if (!job) return console.error('找不到 job_mage_v1，請先上傳職業資料。');

    const procs = collectProcs(job);
    const hitDown = procs.find(p => p.key === 'hit_down') || null;
    const burn = procs.find(p => p.key === 'burn') || null;
    const freeze = procs.find(p => p.key === 'freeze') || null;

    console.log('找到的 proc 設定：');
    console.log(' - hit_down:', hitDown ? {chance: hitDown.chance, duration: hitDown.duration?.value, value: hitDown.params?.value} : '未設定');
    console.log(' - burn:', burn ? {chance: burn.chance, duration: burn.duration?.value, params: burn.params} : '未設定');
    console.log(' - freeze:', freeze ? {chance: freeze.chance, duration: freeze.duration?.value, params: freeze.params} : '未設定');

    const TRIALS = 20000;
    const HITS_PER_SESSION = 6;
    const MONSTER_HP = 1000;

    // hit_down: track proc count and total debuff-turns across sequences
    let hitDownProcs = 0;
    let totalHitDownDebuffTurns = 0;

    // burn: track proc count and total DOT damage across sequences
    let burnProcs = 0;
    let totalBurnDot = 0;

    // freeze: track for boss vs non-boss
    let freezeProcsNonBoss = 0;
    let freezeProcsBoss = 0;

    for (let t = 0; t < TRIALS; t++) {
      // hit_down state
      let hdRemaining = 0;
      let hdDebuffTurnsThisSeq = 0;

      // burn state
      let burnRemaining = 0;
      let burnPct = 0; // percent per turn
      let burnDotThisSeq = 0;

      // freeze state (non-boss)
      let freezeAppliedNonBoss = 0;
      // freeze state (boss)
      let freezeAppliedBoss = 0;

      for (let hit = 0; hit < HITS_PER_SESSION; hit++) {
        // simulate a hit attempt for each proc
        // hit_down
        if (hitDown && Math.random() * 100 < Number(hitDown.chance || 0)) {
          hitDownProcs++;
          hdRemaining = Number(hitDown.duration?.value) || 0; // refresh
        }
        if (hdRemaining > 0) { hdDebuffTurnsThisSeq++; hdRemaining--; }

        // burn
        if (burn && Math.random() * 100 < Number(burn.chance || 0)) {
          burnProcs++;
          burnRemaining = Number(burn.duration?.value) || 0; // refresh
          // params.value may be percent when mode==='pct'
          burnPct = Number(burn.params?.value) || 0;
        }
        if (burnRemaining > 0) {
          if ((String(burn.params?.mode || '').toLowerCase()) === 'pct') {
            burnDotThisSeq += (MONSTER_HP * burnPct / 100);
          } else {
            burnDotThisSeq += burnPct;
          }
          burnRemaining--;
          if (burnRemaining === 0) burnPct = 0;
        }

        // freeze: non-boss（bossImmune 只應該影響 boss，不應該影響非 Boss）
        if (freeze && Math.random() * 100 < Number(freeze.chance || 0)) {
          // 非 Boss 永遠可以被冰凍（除非遊戲另有全域免疫）
          freezeAppliedNonBoss++;
        }

        // freeze: boss scenario (應考慮 bossImmune)
        if (freeze && Math.random() * 100 < Number(freeze.chance || 0)) {
          const bossImmune = !!freeze.params?.bossImmune;
          if (!bossImmune) freezeAppliedBoss++;
        }
      }

      totalHitDownDebuffTurns += hdDebuffTurnsThisSeq;
      totalBurnDot += burnDotThisSeq;
      freezeProcsNonBoss += freezeAppliedNonBoss;
      freezeProcsBoss += freezeAppliedBoss;
    }

    console.log(`\n模擬 ${TRIALS} 個序列（每序列 ${HITS_PER_SESSION} 次命中）:`);
    if (hitDown) {
      console.log(` - hit_down 總觸發次數: ${hitDownProcs}，整體觸發率 ${(hitDownProcs / (TRIALS * HITS_PER_SESSION) * 100).toFixed(2)}%`);
      console.log(` - 每序列平均被麻痺回合數: ${(totalHitDownDebuffTurns / TRIALS).toFixed(3)} 回合 (每回合表示一次命中間隔)`);
    }
    if (burn) {
      console.log(` - burn 總觸發次數: ${burnProcs}，整體觸發率 ${(burnProcs / (TRIALS * HITS_PER_SESSION) * 100).toFixed(2)}%`);
      console.log(` - 每序列平均燒傷總傷害: ${(totalBurnDot / TRIALS).toFixed(3)} 點（基於怪物 HP=${MONSTER_HP}）`);
    }
    if (freeze) {
      console.log(` - freeze 非 Boss 總觸發次數: ${freezeProcsNonBoss}，觸發率 ${(freezeProcsNonBoss / (TRIALS * HITS_PER_SESSION) * 100).toFixed(2)}%`);
      console.log(` - freeze Boss 模擬（考慮 bossImmune）總觸發次數: ${freezeProcsBoss}，觸發率 ${(freezeProcsBoss / (TRIALS * HITS_PER_SESSION) * 100).toFixed(2)}%`);
      console.log(`   （若 proc 定義含 bossImmune=true，則 Boss 應當無法被冰凍）`);
    }

    await client.close();
  } catch (err) {
    console.error('發生錯誤：', err);
    try { await client.close(); } catch(e){}
  }
}

main();
