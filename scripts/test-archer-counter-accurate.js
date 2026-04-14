"use strict";
const { runCombatLoop } = require("../src/shared/combatLoop");

(async function(){
  const trials = 2000;
  let counterCount = 0;
  let counterCritCount = 0;

  const pStats = {
    atk: 20,
    dmgMin: 0.9,
    dmgMax: 1.1,
    maxHp: 100,
    weaponType: 'bow',
    armorBreakChance: 0,
    critDamage: 2.5,
    crit: 5,
    dodge: 80,
    hit: 80,
    isDualWield: false,
    blockChance: 0,
    blockCounter: false,
    counterChance: 0,
    counterInheritStun: false,
    counterInheritBreak: false,
    combo: 0,
    comboDamageMultiplier: 1,
    executeChance: 0,
    executeThresholdPct: 0,
    finalDamageMultiplier: 1
  };

  const mCalc = { atk: 10, def: 10, hit: 50, dodge: 0 };

  const equipped = {
    weapon: { itemId: 'bow_1', weaponType: 'bow' },
    job: { itemId: 'job_archer_v1', passiveEffects: [
      { key: 'counter_on_dodge', trigger: 'passive', chance: 100, params: { critChance: 25 }, condition: { weaponType: 'bow' } }
    ] }
  };

  for (let i=0;i<trials;i++){
    const res = runCombatLoop(pStats, mCalc, 'TestMon', 10000, 2, { equipped, inventory: [] });
    const logs = res.roundLogs.join('\n');
    const lines = logs.split('\n');
    for (const line of lines) {
      if (line.includes('迴避反擊')) {
        counterCount++;
        if (line.includes('暴擊') || line.includes('✨')) counterCritCount++;
      }
    }
  }

  console.log(`試驗次數: ${trials}`);
  console.log(`反擊觸發次數 (line-based): ${counterCount}，反擊暴擊次數: ${counterCritCount}`);
  console.log(`反擊暴擊比率 (line-based): ${(counterCritCount/Math.max(1,counterCount)*100).toFixed(2)}%`);
})();
