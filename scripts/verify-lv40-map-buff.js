"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { loadBson } = require("./verify-normal-progression");
const { MonsterService } = require("../src/services/monster/monsterService");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { buildPlan } = require("./buff-lv40-map-monsters");
const SEED = 937451, RUNS = 200;
async function main() {
  const arg = k => process.argv.find(a => a.startsWith(k + "="))?.slice(k.length + 1);
  const baseline = loadBson(path.join(arg("--baseline"), "monsters.bson"));
  const items = loadBson(path.join(arg("--baseline"), "items.bson"));
  const plan = buildPlan(baseline);
  const live = arg("--live-snapshot") ? loadBson(path.join(arg("--live-snapshot"), "monsters.bson"))
    : baseline.map(m => ({ ...m, ...plan.find(p => p.id === m.id)?.values }));
  const oldMonsters = await new MonsterService({ findAll: async () => baseline }).listMonsters();
  const newMonsters = await new MonsterService({ findAll: async () => live }).listMonsters();
  const rows = [], failures = []; let battles = 0;
  const originalRandom = Math.random;
  try {
    for (const row of plan) {
      const before = oldMonsters.find(m => m.id === row.id), after = newMonsters.find(m => m.id === row.id);
      assert.equal(after.calc.maxHp, before.calc.maxHp * 2);
      assert.ok(Math.abs(after.calc.atk / before.calc.atk - 1.5) < 1e-8);
      const own = before.equipment?.special_1;
      const card = own?.monsterCardSkill?.key ? own : items.find(i => i.equipSlot === "special" && String(i.name).includes(before.name + "卡"));
      const totals = {};
      for (const skills of [false, true]) {
        const sums = [0, 0];
        for (let i = 0; i < RUNS; i++) for (const [n, monster] of [before, after].entries()) {
          let seed = SEED + i;
          Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
          const stats = { ...calcPlayerStats({ str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }, {}, [], []),
            atk: 1, hp: 1e9, maxHp: 1e9, def: 0, flatDef: 0, mdef: 0, dodge: 0, blockChance: 0 };
          // Basic control isolates the ATK multiplier. The second mode keeps
          // boss segment splitting and real cards, which can change RNG/action counts.
          const result = runCombatLoop(stats, { ...monster.calc, isBoss: skills && monster.isBoss }, monster.name, monster.calc.maxHp, 15, {
            playerLevel: monster.level, equipped: {}, inventory: [], zone: monster.zone, monsterIsBoss: skills && monster.isBoss,
            monsterEquipped: skills && card ? { special_1: card } : {} });
          const damage = stats.maxHp - result.finalPlayerHp;
          assert.ok(Number.isFinite(damage) && damage >= 0, monster.name + ": invalid damage");
          sums[n] += damage; battles++;
        }
        const ratio = sums[1] / sums[0];
        if (!skills && (!Number.isFinite(ratio) || Math.abs(ratio - 1.5) > 0.015)) failures.push(row.name + ": undefended base damage ratio " + ratio);
        totals[skills ? "withMonsterCard" : "basic"] = { oldMeanDamage: sums[0] / RUNS, newMeanDamage: sums[1] / RUNS, ratio };
      }
      rows.push({ id: row.id, name: row.name, zone: row.zone, boss: before.isBoss, level: before.level,
        hpBefore: before.calc.maxHp, hpAfter: after.calc.maxHp, atkBefore: before.calc.atk, atkAfter: after.calc.atk,
        monsterCardKey: card?.monsterCardSkill?.key || null, ...totals });
    }
  } finally { Math.random = originalRandom; }
  const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const files = [__filename, require.resolve("../src/shared/combatLoop"), require.resolve("../src/services/monster/monsterService")];
  const report = { generatedAt: new Date().toISOString(), sourceMode: arg("--live-snapshot") ? "live snapshot" : "snapshot plus plan",
    seed: SEED, runs: RUNS, battles, passed: !failures.length, failures,
    hashes: Object.fromEntries(files.map(f => [f, hash(f)])), rows };
  fs.writeFileSync(arg("--output"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, monsters: rows.length, battles, failures }));
  if (failures.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
