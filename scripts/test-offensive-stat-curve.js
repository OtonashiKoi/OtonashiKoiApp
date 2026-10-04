"use strict";

const assert = require("node:assert/strict");
const { effectiveOffensiveStat, offensiveStatGain } = require("../src/shared/offensiveStatCurve");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

assert.equal(effectiveOffensiveStat(0), 0);
assert.equal(effectiveOffensiveStat(10), 12.5);
assert.equal(effectiveOffensiveStat(30), 37.5);
for (let value = 1; value <= 200; value++) {
  assert(effectiveOffensiveStat(value) > effectiveOffensiveStat(value - 1), `主屬性 ${value} 點應繼續成長`);
}
assert(offensiveStatGain(10, 20) > offensiveStatGain(90, 100), "前期 10 點的攻擊收益應高於後期 10 點");

const weapons = [
  ["sword_1h", "str", 4], ["dagger", "agi", 3], ["staff_2h", "int", 4],
  ["bow", "dex", 4], ["dice", "luk", 1.5],
];
for (const [weaponType, main, mult] of weapons) {
  const attributes = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1, [main]: 90 };
  const stats = calcPlayerStats(attributes, { weapon: { weaponType, equipSlot: "weapon" } });
  assert.equal(stats[main], 90, `${weaponType} 的原始屬性不可改寫`);
  assert.equal(stats.weaponMainStatValue, effectiveOffensiveStat(90), `${weaponType} 的追加傷害應稀釋`);
  assert.equal(stats.atk, Math.round(effectiveOffensiveStat(90) * mult), `${weaponType} 的 ATK 應稀釋`);
}

const sword = { weaponType: "sword_1h", equipSlot: "weapon" };
const base = { str: 80, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
const buffed = calcPlayerStats(base, { weapon: sword }, [{ key: "str_up", params: { value: 10 } }]);
const allocated = calcPlayerStats({ ...base, str: 90 }, { weapon: sword });
assert.equal(buffed.atk, allocated.atk, "被動加屬與直接配點的 ATK 應相同");
assert.equal(buffed.weaponMainStatValue, allocated.weaponMainStatValue, "被動加屬與直接配點的追加傷害應相同");

const originalRandom = Math.random;
Math.random = () => 0.5;
try {
  const damageAt = (str) => {
    const stats = calcPlayerStats({ ...base, str }, { weapon: sword });
    const monster = { atk: 1, def: 0, flatDef: 0, dodge: 0, hit: 0, crit: 0 };
    return runCombatLoop(stats, monster, "測試木樁", 1_000_000, 1, { equipped: { weapon: sword } }).totalDamage;
  };
  assert(damageAt(20) - damageAt(10) > damageAt(100) - damageAt(90), "實戰每 10 點前期傷害收益應較高");
} finally {
  Math.random = originalRandom;
}

console.log("offensive stat curve: OK");
