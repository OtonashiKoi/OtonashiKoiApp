"use strict";
const { runCombatLoop } = require("../src/shared/combatLoop");

(async function(){
  const trials = 1000;
  let counterCount = 0;
  let critCount = 0;

  const pStats = {
    atk: 20,
    dmgMin: 0.9,
    dmgMax: 1.1,
    maxHp: 100,
    weaponType: 'bow',
    armorBreakChance: 0,
    critDamage: 2.5,
    crit: 5,
    dodge: 80, // high dodge to cause monster misses
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

  const mCalc = {
    atk: 10,
    def: 10,
    hit: 50,
    dodge: 0
  };

  const equipped = {
    weapon: { itemId: 'bow_1', weaponType: 'bow' },
    job: { itemId: 'job_archer_v1', passiveEffects: [
      { key: 'counter_on_dodge', trigger: 'passive', chance: 100, params: { critChance: 25 }, condition: { weaponType: 'bow' } }
    ] }
  };

  for (let i=0;i<trials;i++){
    const res = runCombatLoop(pStats, mCalc, 'TestMon', 10000, 2, { equipped, inventory: [] });
    const logs = res.roundLogs.join('\n');
    if (logs.includes('迴避反擊')) counterCount++;
    if (logs.includes('暴擊') || logs.includes('✨ 暴擊')) critCount += (logs.match(/暴擊/g) || []).length;
  }

  console.log(`試驗次數: ${trials}`);
  console.log(`觸發迴避反擊次數(每場戰鬥): ${counterCount} (${(counterCount/trials*100).toFixed(2)}%)`);
  console.log(`暴擊出現次數(總計): ${critCount}`);
  console.log(`註: 反擊暴擊理論上為 25% 機率。`);

})();
