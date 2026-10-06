"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { loadBson } = require("./verify-normal-progression");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { mergeEquippedFromLibrary } = require("../src/shared/effectEngine");
const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
if (!snapshot || !output) throw Error("snapshot and output required");
const items = loadBson(`${snapshot}/items.bson`);
const monsters = loadBson(`${snapshot}/monsters.bson`);
const card = items.find(x => x.monsterCardSkill?.key === "castle_golem_petrify");
const golem = monsters.find(x => x.monsterCardSkill?.key === "castle_golem_petrify");
const stats = { maxHp: 10000, atk: 100, def: 0, flatDef: 0, agi: 20, dex: 20, int: 0, luk: 0, hit: 100, dodge: 0, crit: 0, combo: 0, dmgMin: 1, dmgMax: 1, level: 30 };
const enemy = { ...stats, critRate: 0 };
const checks = [];
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: e.message }); } }
async function main() {
  const originalDefinition = structuredClone(card.monsterCardSkill);
  const old = Math.random; Math.random = () => .5;
  try {
    await check("live monster and player definition agree", () => assert.deepEqual(golem.equipment.special_1.monsterCardSkill, card.monsterCardSkill));
    await check("existing equipped snapshots use latest library", async () => {
      const merged = await mergeEquippedFromLibrary({ special_1: { itemId: card.id, uuid: "existing-card", monsterCardSkill: { key: "old" } } }, { findById: async () => card });
      assert.deepEqual(merged.special_1.monsterCardSkill, card.monsterCardSkill);
      assert.equal(merged.special_1.uuid, "existing-card");
    });
    for (const owner of ["player", "monster"]) {
      const equipped = { special_1: { ...card, itemId: card.id } };
      const opts = hp => owner === "player" ? { equipped, startPlayerHp: hp, skipMonsterAttack: true } : { monsterEquipped: equipped, startMonsterHp: hp, skipPlayerAttack: true };
      await check(`${owner}: below 30% heals exactly 25% once`, () => {
        const r = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, opts(2999));
        const hp = owner === "player" ? r.finalPlayerHp : r.finalMonsterHp;
        assert.equal(hp, 5499);
        const effects = owner === "player" ? r.playerActiveEffects : r.monsterActiveEffects;
        assert(effects.some(e => e.key === "damage_reduction" && e.params.value === 50));
        assert(!effects.some(e => e.key === "invincible_short"));
      });
      await check(`${owner}: exactly 30% does not trigger`, () => {
        const r = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, opts(3000));
        assert.equal(owner === "player" ? r.finalPlayerHp : r.finalMonsterHp, 3000);
      });
      await check(`${owner}: reduction halves actual damage and never immunizes`, () => {
        const effect = { key: "damage_reduction", params: { value: 50, duration: { mode: "turns", value: 1 } }, appliedAt: 0 };
        const common = owner === "player" ? { skipPlayerAttack: true } : { skipMonsterAttack: true };
        const base = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, common);
        const guarded = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, { ...common, ...(owner === "player" ? { playerActiveEffects: [effect] } : { monsterActiveEffects: [effect] }) });
        const before = owner === "player" ? base.damageTaken : base.totalDamage;
        const after = owner === "player" ? guarded.damageTaken : guarded.totalDamage;
        assert.equal(after, Math.round(before * .5)); assert(after > 0);
      });
      await check(`${owner}: cooldown is five own actions`, () => {
        const session = {}; let cooldowns = { player: {}, monster: {} }; const triggered = [];
        for (let i = 1; i <= 6; i++) {
          const o = { ...opts(2999), actionSession: session, partyActorId: "subject", cardCooldowns: cooldowns };
          const r = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, o);
          cooldowns = r.cardCooldowns;
          if (r.roundLogs.some(l => l.includes("石化再生"))) triggered.push(i);
        }
        assert.deepEqual(triggered, [1, 6]);
      });
      await check(`${owner}: healing decays by successful cast, survives restored sessions, floors at 10%, and resets in new battles`, () => {
        let session = {}, cooldowns = { player: {}, monster: {} }, counts = { player: {}, monster: {} };
        const healing = [], triggered = [];
        for (let i = 1; i <= 36; i++) {
          // Rebuild a session midway using only its durable counters/cooldowns.
          if (i === 17) session = {};
          const r = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1,
            { ...opts(2999), actionSession: session, partyActorId: "subject", cardCooldowns: cooldowns, cardTriggerCounts: counts });
          cooldowns = r.cardCooldowns; counts = r.cardTriggerCounts;
          if (r.roundLogs.some(l => l.includes("石化再生"))) {
            triggered.push(i); healing.push((owner === "player" ? r.finalPlayerHp : r.finalMonsterHp) - 2999);
          }
        }
        assert.deepEqual(triggered, [1, 6, 11, 16, 21, 26, 31, 36]);
        assert.deepEqual(healing, [2500, 2000, 1500, 1250, 1000, 1000, 1000, 1000]);
        assert.equal(counts[owner][card.id], 8);
        const fresh = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, opts(2999));
        assert.equal((owner === "player" ? fresh.finalPlayerHp : fresh.finalMonsterHp) - 2999, 2500);
        const gated = runCombatLoop(stats, enemy, "木樁", enemy.maxHp, 1, opts(3000));
        assert.deepEqual(gated.cardTriggerCounts[owner], {});
      });
    }
  } finally { Math.random = old; }
  await check("battle scaling never mutates the shared skill definition", () => assert.deepEqual(card.monsterCardSkill, originalDefinition));
  const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const report = { generatedAt: new Date().toISOString(), source: snapshot, checks, passed: checks.every(x => x.ok), hashes: Object.fromEntries(["src/shared/combatLoop.js", "scripts/test-castle-golem-card.js", `${snapshot}/items.bson`, `${snapshot}/monsters.bson`].map(p => [p, hash(p)])) };
  fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.checks)); process.exitCode = report.passed ? 0 : 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
