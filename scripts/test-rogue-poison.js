#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function fetchItem(client, query) {
  const db = client.db(process.env.MONGODB_DB_NAME || 'equipment_game');
  const col = db.collection('items');
  return await col.findOne(query);
}

function findProcPoison(job) {
  if (!job || !Array.isArray(job.procEffects)) return null;
  return job.procEffects.find((p) => p.key === 'proc_poison');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  let client = null;
  try {
    if (!uri) throw new Error('MONGODB_URI 未設定於 .env');
    client = new MongoClient(uri, { useUnifiedTopology: true });
    await client.connect();

    const job = await fetchItem(client, { id: 'job_rogue_v1' });
    const proc = findProcPoison(job) || null;
    if (!proc) {
      console.log('找不到 job_rogue_v1 的 proc_poison 設定，請確認職業是否已上傳。');
      await client.close();
      return;
    }

    const chance = Number(proc.chance) || 0;
    const duration = (proc.duration && proc.duration.value) ? Number(proc.duration.value) : 0;
    const perTick = Number(proc.params?.value) || 0; // if mode==='pct' this is percent
    const mode = String(proc.params?.mode || '').toLowerCase();
    const stackAdd = Number(proc.params?.stackAdd) || 0;
    const maxPct = Number(proc.params?.maxPct) || null;

    console.log('proc_poison 設定：chance=', chance, ' duration(turns)=', duration, ' perTick=', perTick, 'mode=', mode, ' stackAdd=', stackAdd, ' maxPct=', maxPct);

    const TRIALS = 20000;
    const HITS_PER_SESSION = 6; // 模擬在 6 次連續命中（每次視為一回合）內的疊層行為
    const MONSTER_HP = 1000;

    let totalProcs = 0;
    let totalDotDamageAll = 0;

    for (let t = 0; t < TRIALS; t++) {
      let currentPct = 0; // current poison percent of max HP per turn
      let remainingTurns = 0;
      let sessionDot = 0;

      for (let hit = 0; hit < HITS_PER_SESSION; hit++) {
        // attempt proc on this hit
        if (Math.random() * 100 < chance) {
          totalProcs++;
          // add stack
          currentPct = Math.min(maxPct || Infinity, currentPct + stackAdd);
          remainingTurns = duration; // refresh duration
        }

        // apply DOT for this turn (after hit)
        if (currentPct > 0 && remainingTurns > 0) {
          const dmgThisTurn = (mode === 'pct') ? (MONSTER_HP * currentPct / 100) : currentPct;
          sessionDot += dmgThisTurn;
        }

        // decrement duration
        if (remainingTurns > 0) remainingTurns--;
        if (remainingTurns === 0) currentPct = 0;
      }

      totalDotDamageAll += sessionDot;
    }

    console.log(`\n模擬 ${TRIALS} 個序列（每序列 ${HITS_PER_SESSION} 次命中）:`);
    console.log(` - 總觸發次數: ${totalProcs} ，整體觸發率 ${(totalProcs / (TRIALS * HITS_PER_SESSION) * 100).toFixed(2)}%`);
    console.log(` - 每個序列平均 DOT 總傷害: ${(totalDotDamageAll / TRIALS).toFixed(3)} 點（基於怪物 HP=${MONSTER_HP}）`);
    console.log(` - 若觸發，單次觸發會增加 ${stackAdd}% 並刷新 ${duration} 回合，單回合最大 DOT% 為 ${maxPct}%`);

    await client.close();
  } catch (err) {
    console.error('發生錯誤：', err);
    if (client) await client.close();
  }
}

main();
