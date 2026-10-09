"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { loadBson } = require("./verify-normal-progression");
const { runCombatLoop } = require("../src/shared/combatLoop");
const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
assert.ok(snapshot && output, "snapshot and external output required");
let card = loadBson(`${snapshot}/items.bson`).find(i => i.id === "monster-card-northwind-hutao");
assert.ok(card);
if (!process.argv.includes("--live")) card = { ...card, monsterCardSkill: require("./lib/hutao-live-content").skill() };
const player = { level: 65, maxHp: 100000, atk: 100, str: 0, agi: 100, vit: 0,
  int: 0, dex: 100, luk: 0, hit: 100, dodge: 0, crit: 0, combo: 0,
  def: 0, flatDef: 0, blockChance: 0, dmgMin: 1, dmgMax: 1 };
const enemy = { ...player, maxHp: 1000000, atk: 200, critRate: 0, comboChance: 0 };
const checks = [];
let simulations = 0;
function run({ bossCard = true, playerCard = false, stats = {}, monster = {}, options = {}, rounds = 1, random = .11 } = {}) {
  const old = Math.random;
  Math.random = typeof random === "function" ? random : () => random;
  try {
    simulations++;
    return runCombatLoop({ ...player, ...stats }, { ...enemy, ...monster }, "胡桃",
      monster.maxHp || enemy.maxHp, rounds, {
        playerLevel: 65, monsterIsBoss: true,
        equipped: playerCard ? { special_1: { ...structuredClone(card), itemId: card.id } } : {},
        monsterEquipped: bossCard ? { special_1: { ...structuredClone(card), itemId: card.id } } : {},
        ...options,
      });
  } finally { Math.random = old; }
}
function lines(result) { return result.roundLogs.join("\n"); }
function hits(result) { return [...lines(result).matchAll(/胡桃\*\* 發動【東南西北】連鎖打擊，造成 \*\*(\d+)\*\*/g)].map(m => Number(m[1])); }
function check(name, fn) {
  try { checks.push({ name, passed: true, ...fn() }); }
  catch (error) { checks.push({ name, passed: false, error: error.stack }); }
}
check("boss confirmed hit adds four actual 45% ATK hits after its attack", () => {
  const r = run(), base = run({ bossCard: false });
  assert.deepEqual(hits(r), [90, 90, 90, 90]);
  assert.equal(r.damageTaken - base.damageTaken, 360);
  assert.equal(player.maxHp - r.finalPlayerHp, r.damageTaken);
  assert(lines(r).indexOf("💥") < lines(r).indexOf("發動【東南西北】"));
  assert(!(r.playerActiveEffects || []).some(e => e.key === "proc_chain_hit"));
  return { withCard: r.damageTaken, withoutCard: base.damageTaken };
});
check("new player card does not retain the retired 12% four45% on-hit proc", () => {
  const r = run({ bossCard: false, playerCard: true, rounds: 3, options: { skipMonsterAttack: true } });
  assert(!lines(r).includes("連鎖打擊"));
});
check("12% chance boundary rejects .12 and accepts .119", () => {
  assert.equal(hits(run({ random: .12 })).length, 0);
  assert.equal(hits(run({ random: .119 })).length, 4);
});
check("monster misses and failed attack tiers do not cast", () => {
  for (const r of [run({ random: .01, options: { skipPlayerAttack: true } }), run({ random: .5, stats: { dodge: 100 }, monster: { hit: 0 }, options: { skipPlayerAttack: true } })]) {
    assert.equal(hits(r).length, 0); assert.equal(r.damageTaken, 0);
  }
});
check("silence, stun, freeze, AGI suppression and external turns prevent casts", () => {
  const effects = ["silence", "stun", "freeze"].map(key => ({ key, appliedAt: 0, params: { duration: { mode: "turns", value: 3 } } }));
  for (const effect of effects) assert.equal(hits(run({ options: { monsterActiveEffects: [effect] } })).length, 0);
  assert.equal(hits(run({ stats: { agi: 116 } })).length, 0);
  assert.equal(hits(run({ options: { skipMonsterAttack: true } })).length, 0);
});
check("defense, reduction, shields and invulnerability affect actual chain HP loss", () => {
  const defended = run({ stats: { def: 50 } });
  assert(hits(defended).every(v => v < 90));
  const reduction = { key: "physical_damage_reduction", appliedAt: 0, params: { value: 50, duration: { mode: "turns", value: 3 } } };
  assert.deepEqual(hits(run({ options: { playerActiveEffects: [reduction] } })), [45, 45, 45, 45]);
  for (const effect of [{ key: "shield", params: { amount: 10000 } }, { key: "invincible_short", params: {} }]) {
    const r = run({ options: { playerActiveEffects: [{ ...effect, appliedAt: 0 }] } });
    assert.equal(r.damageTaken, 0); assert.equal(r.finalPlayerHp, player.maxHp);
  }
});
check("boss attack split checks chance only once per round", () => {
  const r = run({ monster: { atk: 10000 }, options: { monsterIsBossUnit: true } });
  assert.equal(hits(r).length, 4);
});
check("lethal first hit never casts; lethal chain stops and records loss", () => {
  const dead = run({ options: { startPlayerHp: 1 } });
  assert.equal(hits(dead).length, 0); assert.equal(dead.outcome, "lose");
  const base = run({ bossCard: false });
  const r = run({ options: { startPlayerHp: base.damageTaken + 1 } });
  assert.equal(hits(r).length, 1); assert.equal(r.outcome, "lose"); assert(r.finalPlayerHp <= 0);
});
check("12% boss cast rate is sampled only on connected attacks", () => {
  let seed = 20261008, connected = 0, casts = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let n = 0; n < 3000; n++) {
    const r = run({ random, options: { skipPlayerAttack: true } });
    if (r.damageTaken > 0) connected++;
    if (hits(r).length) casts++;
  }
  const ratio = casts / connected; assert(ratio > .09 && ratio < .15);
  return { connected, casts, ratio };
});
const report = { generatedAt: new Date().toISOString(), productionWrites: false, snapshot,
  cardHash: crypto.createHash("sha256").update(JSON.stringify(card)).digest("hex"),
  codeHashes: Object.fromEntries(["combatLoop", "hutaoMonsterCard"].map(name => [name,
    crypto.createHash("sha256").update(fs.readFileSync(require.resolve(`../src/shared/${name}`))).digest("hex")])),
  simulations, passed: checks.every(c => c.passed), checks };
fs.writeFileSync(output, JSON.stringify(report, null, 2));
for (const c of checks) console.log(`${c.passed ? "PASS" : "FAIL"}: ${c.name}${c.error ? `\n${c.error}` : ""}`);
if (!report.passed) process.exitCode = 1;
