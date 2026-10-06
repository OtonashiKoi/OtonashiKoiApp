"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { loadBson } = require("./verify-normal-progression");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { withSeed } = require("./lib/seededRandom");
const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
if (!snapshot || !output) throw Error("snapshot and output required");
const items = loadBson(`${snapshot}/items.bson`);
const cards = items.filter(x => x.itemType === "card" || x.monsterCardOf || x.monsterCardSkill || /卡(?:片)?$/.test(x.name || ""));
const clone = structuredClone;
const player = { maxHp: 10000, atk: 100, def: 0, flatDef: 0, str: 0, agi: 0,
  vit: 0, dex: 0, int: 0, luk: 0, hit: 100, dodge: 0, crit: 0, combo: 0,
  dmgMin: 1, dmgMax: 1, level: 40, weaponType: "sword_1h" };
const enemy = { ...player, maxHp: 100000, atk: 100, critRate: 0, comboChance: 0 };
let simulations = 0;
function run(card, options = {}, stats = {}, monster = {}, rounds = 1, random = .5) {
  const old = Math.random; Math.random = () => random;
  try {
    simulations++;
    const equipped = card ? { special_1: { ...clone(card), itemId: card.id, itemName: card.name } } : {};
    return runCombatLoop({ ...player, ...stats }, { ...enemy, ...monster }, "驗收木樁",
      monster.maxHp || enemy.maxHp, rounds, { equipped, playerLevel: 40, skipMonsterAttack: true, ...options });
  } finally { Math.random = old; }
}
function skill(effects, extra = {}) {
  return { id: "trigger-fixture", name: "觸發驗收卡", monsterCardSkill: {
    key: "trigger_fixture", name: "命中驗收", trigger: "on_hit", chance: 100,
    procEffects: effects, ...extra } };
}
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.stack }); }
}
const normalCards = cards.filter(c => c.monsterCardSkill?.trigger === "on_hit" && c.monsterCardSkill.key !== "castle_golem_petrify");
for (const card of normalCards) {
  const testCard = clone(card); testCard.monsterCardSkill.chance = 100;
  check(`${card.name}: misses and critical failures never trigger on_hit`, () => {
    for (const hp of [2000, 9000]) {
      const failed = run(testCard, { startPlayerHp: hp }, {}, {}, 1, .01);
      const missed = run(testCard, { startPlayerHp: hp }, { hit: 0 }, { dodge: 100 });
      for (const r of [failed, missed]) {
        assert.equal(r.totalDamage, 0);
        assert(!r.roundLogs.join("\n").includes(`【${card.monsterCardSkill.name}】`));
        assert.equal((r.playerActiveEffects || []).filter(e => e.sourceType?.includes("card")).length, 0);
        assert.equal((r.monsterActiveEffects || []).filter(e => e.sourceType?.includes("card")).length, 0);
        assert(!Object.values(r.cardCooldowns.player).some(Number));
      }
    }
  });
}
const extra = skill([{ key: "proc_extra_hit", target: "enemy", params: { damageMultiplier: .5 } }]);
check("main hit precedes exactly one card cast, including combo actions", () => {
  const r = run(extra, {}, { combo: 100 });
  const text = r.roundLogs.join("\n");
  assert.equal((text.match(/發動【命中驗收】追擊/g) || []).length, 1);
  assert(text.indexOf("⚔️") < text.indexOf("發動【命中驗收】追擊"));
  assert(r.totalDamage >= 150);
});
check("three special slots each receive one independent cast", () => {
  const equipped = Object.fromEntries([1, 2, 3].map(n => [`special_${n}`, { ...clone(extra), itemId: `slot${n}` }]));
  const r = run(null, { equipped });
  assert.equal((r.roundLogs.join("\n").match(/發動【命中驗收】追擊/g) || []).length, 3);
});
check("silence, stun and isolated monster actions prevent player card casts", () => {
  for (const key of ["silence", "stun"]) {
    const r = run(extra, { playerActiveEffects: [{ key, appliedAt: 0, params: { duration: { mode: "turns", value: 2 } } }] });
    assert(!r.roundLogs.join("\n").includes("發動【命中驗收】"));
  }
  assert.equal(run(extra, { skipPlayerAttack: true }).totalDamage, 0);
});
check("HP thresholds apply on the confirmed hit and honor the strict boundary", () => {
  const c = skill([{ key: "atk_up", target: "self", params: { value: 20, ownerHpBelowPct: 50, duration: { mode: "turns", value: 2 } } }]);
  assert.equal(run(c, { startPlayerHp: 5000 }).playerActiveEffects.length, 0);
  const r = run(c, { startPlayerHp: 4999 });
  assert(r.playerActiveEffects.some(e => e.key === "atk_up"));
  assert.equal(r.totalDamage, run(null, { startPlayerHp: 4999 }).totalDamage);
  c.monsterCardSkill.cooldownTurns = 5;
  assert(!Object.values(run(c, { startPlayerHp: 5000 }).cardCooldowns.player).some(Number));
});
check("explicit self penalties stay on the owner", () => {
  const c = cards.find(c => c.monsterCardSkill?.key === "castle_assassin_agi");
  c.monsterCardSkill.chance = 100;
  const r = run(c, { startPlayerHp: 9000 });
  assert(r.playerActiveEffects.some(e => e.key === "atk_down"));
  assert(!r.monsterActiveEffects.some(e => e.key === "atk_down"));
});
check("one-turn on-hit buffs affect the next own action, then expire", () => {
  const c = skill([{ key: "atk_up", target: "self", params: { value: 100, duration: { mode: "turns", value: 1 } } }], { cooldownTurns: 99 });
  const one = run(c, {}, {}, {}, 1), two = run(c, {}, {}, {}, 2), three = run(c, {}, {}, {}, 3);
  const base = run(null).totalDamage;
  assert.equal(one.totalDamage, base);
  assert.equal(two.totalDamage - one.totalDamage, base * 2);
  assert.equal(three.totalDamage - two.totalDamage, base);
});
check("on-hit reduction and invulnerability protect against the immediate counterattack", () => {
  const base = run(null, { skipMonsterAttack: false }).damageTaken;
  const reduction = skill([{ key: "damage_reduction", target: "self", params: { value: 50, duration: { mode: "turns", value: 1 } } }]);
  assert.equal(run(reduction, { skipMonsterAttack: false }).damageTaken, Math.round(base * .5));
  const invincible = skill([{ key: "invincible_short", target: "self", params: { duration: { mode: "turns", value: 1 } } }]);
  assert.equal(run(invincible, { skipMonsterAttack: false }).damageTaken, 0);
});
check("refreshing an existing defensive buff does not double its reduction", () => {
  const reduction = skill([{ key: "damage_reduction", target: "self", params: { value: 50, duration: { mode: "turns", value: 1 } } }]);
  const a = run(reduction, { skipMonsterAttack: false }, {}, {}, 1);
  const b = run(reduction, { skipMonsterAttack: false }, {}, {}, 2);
  assert.equal(b.damageTaken - a.damageTaken, a.damageTaken);
});
check("successful casts respect cooldown across restored action sessions", () => {
  const c = { ...clone(extra), monsterCardSkill: { ...clone(extra.monsterCardSkill), cooldownTurns: 3 } };
  let cooldowns = { player: {}, monster: {} }, session = {}, casts = [];
  for (let action = 1; action <= 5; action++) {
    const r = run(c, { actionSession: session, cardCooldowns: cooldowns, partyActorId: "test",
      startPlayerHp: player.maxHp, startMonsterHp: enemy.maxHp });
    cooldowns = r.cardCooldowns;
    if (action === 2) session = {};
    if (r.roundLogs.join("\n").includes("發動【命中驗收】追擊")) casts.push(action);
  }
  assert.deepEqual(casts, [1, 4]);
});
check("lethal main hits do not add damage to a dead target", () => {
  const r = run(extra, {}, {}, { maxHp: 1 });
  assert(!r.roundLogs.join("\n").includes("發動【命中驗收】追擊"));
});
check("damage_taken_up multiplies actual physical and magic HP loss", () => {
  const penalty = { key: "damage_taken_up", appliedAt: 0, params: { value: 10, duration: { mode: "turns", value: 2 } } };
  for (const monsterEquipped of [{}, { special_1: { monsterCardSkill: { key: "magic_test", name: "雷擊", chance: 100,
    procEffects: [{ key: "lightning", target: "enemy", params: { mode: "flat", value: 100 } }] } } }]) {
    const opts = { skipPlayerAttack: true, skipMonsterAttack: false, monsterEquipped };
    const base = run(null, opts), guarded = run(null, { ...opts, playerActiveEffects: [clone(penalty)] });
    assert(guarded.damageTaken > base.damageTaken);
    assert(Math.abs(guarded.damageTaken - base.damageTaken * 1.1) <= 2);
    assert.equal(guarded.finalPlayerHp, player.maxHp - guarded.damageTaken);
  }
});
check("live rust card increases actual damage taken compared with the same card without its penalty", () => {
  const c = cards.find(c => c.monsterCardSkill?.key === "rust_axe_smash");
  const without = clone(c); without.monsterCardSkill.procEffects = without.monsterCardSkill.procEffects.filter(e => e.key !== "damage_taken_up");
  const opts = { skipMonsterAttack: false, startPlayerHp: 2000 };
  const a = run(c, opts, {}, {}, 3, .2), b = run(without, opts, {}, {}, 3, .2);
  assert(a.playerActiveEffects.some(e => e.key === "damage_taken_up"));
  assert(a.damageTaken > b.damageTaken);
  assert(a.finalPlayerHp < b.finalPlayerHp);
});
check("damage penalty expires and cannot bypass invulnerability", () => {
  const penalty = { key: "damage_taken_up", appliedAt: 1, params: { value: 10, duration: { mode: "turns", value: 1 } } };
  const opts = { skipPlayerAttack: true, skipMonsterAttack: false, playerActiveEffects: [penalty] };
  const a = run(null, opts, {}, {}, 2), b = run(null, opts, {}, {}, 3);
  assert.equal(b.damageTaken - a.damageTaken, run(null, { skipPlayerAttack: true, skipMonsterAttack: false }).damageTaken);
  const r = run(null, { ...opts, playerActiveEffects: [penalty, { key: "invincible_short", params: {} }] });
  assert.equal(r.damageTaken, 0);
});
check("chain card and wizard echo check once per successful cast without recursion", () => {
  const chain = skill([{ key: "proc_chain_hit", target: "enemy", params: { chainCount: 3, damageMultiplier: .3 } }]);
  const wizard = cards.find(c => c.monsterCardSkill?.key === "mistwood_wizard_echo");
  const equipped = { special_1: { ...chain, itemId: chain.id }, special_2: { ...wizard, itemId: wizard.id } };
  const r = run(null, { equipped });
  assert.equal(r.mistwoodCardMetrics.echoChecks, 1);
  assert.equal((r.roundLogs.join("\n").match(/連鎖打擊/g) || []).length, 3);
});
check("live assassin dodge effect changes HP loss below the hit-rate cap", () => {
  const c = clone(cards.find(c => c.monsterCardSkill?.key === "castle_assassin_agi"));
  c.monsterCardSkill.procEffects = c.monsterCardSkill.procEffects.filter(e => e.key === "dodge_up");
  const inert = clone(c); inert.monsterCardSkill.procEffects[0].key = "audit_noop";
  const seeded = card => withSeed("assassin-coverage:17", () => {
    simulations++;
    return runCombatLoop({ ...player, dodge: 40 }, { ...enemy, atk: 1, agi: 10 }, "驗收木樁", enemy.maxHp, 15,
      { playerLevel: 40, startPlayerHp: 9000, equipped: { special_1: { ...card, itemId: card.id } } });
  });
  assert(seeded(c).damageTaken < seeded(inert).damageTaken);
});
const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(require.resolve("../src/shared/combatLoop"))).digest("hex");
fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), sourceHash, snapshot,
  productionWrites: false, liveCardCount: cards.length, onHitCardCount: normalCards.length,
  simulations, passed: checks.every(c => c.ok), checks }, null, 2));
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}: ${c.name}${c.ok ? "" : `\n${c.error}`}`);
if (checks.some(c => !c.ok)) process.exitCode = 1;
