"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { BSON } = require("mongodb");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { buildTimeline } = require("../src/shared/battlePresentationParser");
const { NormalLiveCombat } = require("../src/services/realtime/normalLiveCombat");
const { ZoneCombatScene } = require("../src/services/realtime/zoneCombatScene");

const snapshot = process.argv[2];
const checks = [];
let battles = 0;
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function readBson(file) {
  const bytes = fs.readFileSync(file), rows = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = bytes.readInt32LE(offset);
    rows.push(BSON.deserialize(bytes.subarray(offset, offset + length)));
    offset += length;
  }
  return rows;
}
const rings = snapshot ? readBson(path.join(snapshot, "items.bson")).filter(item => item.name === "吸血左之戒")
  : [5, 10, 15].map((value, i) => ({ id: `leech-${i}`, name: "吸血左之戒", tier: ["C", "B", "A"][i],
    equipStats: { luk: i + 1 }, passiveEffects: [{ key: "lifesteal", trigger: "passive", target: "self", params: { value } }] }));
assert.equal(rings.length, 3, "需要 C/B/A 三階目前道具資料");
const attrs = { str: 20, agi: 20, vit: 10, int: 10, dex: 20, luk: 1 };
const monsterStats = { maxHp: 10000, atk: 1, def: 0, flatDef: 0, str: 1, agi: 1, vit: 1,
  int: 1, dex: 1, luk: 1, hit: 0, dodge: 0, critRate: 0, critDamage: 1.5 };
const effect = (key, value) => ({ key, trigger: "passive", target: "self", params: { value } });
function equipment(ring, extra = {}) {
  return { accessory_l: { ...ring, itemId: ring.id }, ...extra };
}
function playerStats(equipped, extra = {}) {
  return { ...calcPlayerStats(attrs, equipped), ...attrs, maxHp: 1000, hp: 1000, atk: 200,
    def: 10, flatDef: 0, hit: 1000, dodge: 0, crit: 0, critRate: 0, critDamage: 1.5, combo: 0,
    comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1, weaponType: "sword_1h",
    weaponMainStatValue: 0, finalDamageMultiplier: 1, ...extra };
}
function battle(ring, { hp = 10000, startHp = 500, stats = {}, enemy = {}, options = {}, equipped = {} } = {}) {
  const gear = equipment(ring, equipped);
  battles++;
  return runCombatLoop(playerStats(gear, stats), { ...monsterStats, maxHp: hp, ...enemy }, "測試木樁", hp, 1,
    { equipped: gear, inventory: [], startPlayerHp: startHp, ...options });
}
async function check(name, work) {
  try { await work(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
function assertHealing(result, expected) {
  assert.equal(result.lifestealDone, expected);
  assert.equal(result.finalPlayerHp, 500 + expected);
  assert.equal(result.healDone, 0, "吸血不列入一般治療");
  const lines = result.roundLogs.flatMap(line => line.split("\n")).filter(line => line.includes("吸取生命力"));
  assert.equal(lines.length, 1, "一次行動只結算一次吸血");
  assert.ok(lines[0].includes(`恢復 **${expected}** HP`));
  const healing = buildTimeline(result.roundLogs, "測試玩家", "測試木樁").filter(e => e.type === "heal");
  assert.ok(healing.some(e => e.value === expected), "HUD 演出需收到實際回血");
}

async function liveIntegration(ring) {
  let now = 1000;
  let state = { activeMonsterSeq: 1, currentHp: 10000, encounterCount: 1, encounterMonsterSeq: 1, damageMap: {}, participants: [] };
  const gear = equipment(ring), packets = [];
  const enemy = { id: "ring-test", seq: 1, name: "測試木樁", calc: { ...monsterStats, atk: 100, hit: 1000 } };
  const sc = { monsterService: { getState: async () => structuredClone(state),
    saveStateIfActiveMonster: async (next, zone, seq, expected) => {
      if (seq !== state.activeMonsterSeq || expected !== state.currentHp) return false;
      state = structuredClone(next); return true;
    } } };
  const engine = new NormalLiveCombat({ now: () => now, auto: false, starterNpcs: false,
    scene: new ZoneCombatScene({ now: () => now, emit: () => {} }), emit: (id, packet) => packets.push(packet) });
  const pending = engine.join({ sc, zone: "normal", monster: enemy, state, actorId: "ring-qa", actorName: "測試玩家",
    stats: playerStats(gear, { agi: 1 }), monsterStats: enemy.calc,
    options: { equipped: gear, inventory: [], playerActiveEffects: [], playerLevel: 1, playerName: "測試玩家", zone: "normal" } });
  pending.catch(() => {});
  await engine.queues.get("normal");
  try {
    now = engine.zones.get("normal").enemyAt; await engine.advance("normal"); // First enemy pulse wounds the actor before its first attack.
    const before = state.normalLive.actors["ring-qa"].hp;
    assert.ok(before < 1000);
    now++; await engine.advance("normal"); battles += 2;
    const restored = Math.round(200 * ring.passiveEffects[0].params.value / 100);
    assert.equal(state.normalLive.actors["ring-qa"].hp, before + restored, "回血必須寫入 CAS 狀態");
    assert.equal(state.normalLive.actors["ring-qa"].result.lifestealDone, restored);
    assert.ok(packets.some(p => p.type === "normal_live_action" && p.data.logs.some(line => line.includes("吸取生命力"))));
    assert.ok(engine.vitals.get("ring-qa").events.some(e => e.kind === "heal" && e.damage === restored));
  } finally {
    engine.failRoom(engine.zones.get("normal"), new Error("fixture complete"));
    await Promise.allSettled([pending]);
  }
}

(async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    for (const ring of rings) {
      const value = ring.passiveEffects[0].params.value, expected = value * 2;
      await check(`${ring.tier}: nonlethal hit`, () => assertHealing(battle(ring), expected));
      await check(`${ring.tier}: lethal main hit`, () => {
        const r = battle(ring, { hp: 200 }); assert.equal(r.outcome, "win"); assertHealing(r, expected);
      });
      await check(`${ring.tier}: live first action retains injected passive despite empty command effects`, () => {
        const r = battle(ring, { options: { actionSession: {}, liveNormalCombat: true, startMonsterHp: 10000,
          skipMonsterAttack: true, playerActiveEffects: [] } }); assertHealing(r, expected);
      });
      await check(`${ring.tier}: live lethal main hit`, () => {
        const r = battle(ring, { hp: 200, options: { actionSession: {}, liveNormalCombat: true, startMonsterHp: 200,
          skipMonsterAttack: true, playerActiveEffects: [] } }); assert.equal(r.outcome, "win"); assertHealing(r, expected);
      });
      await check(`${ring.tier}: live durable HP, SSE and HUD`, () => liveIntegration(ring));
    }
    const ring = rings.find(r => r.tier === "A");
    await check("live commands cannot erase passives or temporary skill effects; sources do not multiply", () => {
      const gear = equipment(ring), session = {};
      const command = { equipped: gear, inventory: [], startPlayerHp: 500, startMonsterHp: 10000,
        actionSession: session, liveNormalCombat: true, skipMonsterAttack: true, playerActiveEffects: [effect("lifesteal", 5)] };
      const first = runCombatLoop(playerStats(gear), monsterStats, "測試木樁", 10000, 15, command); battles++;
      assertHealing(first, 40);
      const second = runCombatLoop(playerStats(gear), monsterStats, "測試木樁", first.finalMonsterHp, 15,
        { ...command, startPlayerHp: 500, startMonsterHp: first.finalMonsterHp, playerActiveEffects: [] }); battles++;
      assert.equal(second.finalPlayerHp, 540);
      assert.equal(second.playerActiveEffects.filter(e => e.sourceType === "equipment_passive" && e.key === "lifesteal").length, 1);
    });
    await check("lethal second segment includes main hit exactly once", () => {
      const r = battle(ring, { hp: 300, stats: { attackSegments: 2 } }); assert.equal(r.outcome, "win"); assertHealing(r, 60);
    });
    await check("lethal combo includes main and combo exactly once", () => {
      const r = battle(ring, { hp: 300, stats: { combo: 100 } }); assert.equal(r.outcome, "win"); assertHealing(r, 60);
    });
    await check("three-tile lethal sequence settles whole round", () => {
      const r = battle(ring, { hp: 150, equipped: { card_1: { passiveEffects: [effect("triple_strike", 3)] } } });
      assert.equal(r.outcome, "win"); assertHealing(r, Math.round(r.totalDamage * 0.15));
    });
    await check("elementalist lethal volley settles whole round", () => {
      const r = battle(ring, { hp: 180, equipped: { job_eq: { itemId: "job_elementalist_t2_v1" } }, options: { stance: "storm" } });
      assert.equal(r.outcome, "win"); assertHealing(r, Math.round(r.totalDamage * 0.15));
    });
    await check("sniper finisher still settles preceding ordinary hit", () => {
      const r = battle(ring, { hp: 300, equipped: { job_eq: { itemId: "job_sniper_t2_v1" } }, options: { sniperGaugeGrids: 3 } });
      assert.equal(r.outcome, "win"); assertHealing(r, 30);
    });
    await check("full HP overflow contributes zero", () => {
      const r = battle(ring, { hp: 200, startHp: 1000 }); assert.equal(r.finalPlayerHp, 1000); assert.equal(r.lifestealDone, 0);
    });
    await check("near-full HP is clamped to maximum", () => {
      const r = battle(ring, { hp: 200, startHp: 990 }); assert.equal(r.finalPlayerHp, 1000); assert.equal(r.lifestealDone, 10);
    });
    await check("zero damage cannot produce lifesteal", () => {
      const r = battle(ring, { options: { skipPlayerAttack: true, skipMonsterAttack: true } });
      assert.equal(r.totalDamage, 0); assert.equal(r.lifestealDone, 0); assert.equal(r.finalPlayerHp, 500);
    });
    await check("dead player cannot resurrect from unsettled damage", () => {
      const r = battle(ring, { startHp: 1, stats: { agi: 1 }, enemy: { atk: 2000, hit: 1000 } });
      assert.equal(r.outcome, "lose"); assert.equal(r.finalPlayerHp, 0); assert.equal(r.lifestealDone, 0);
    });
    await check("25 percent equipment cap and separate enchant bonus remain", () => {
      const r = battle(ring, { hp: 200, equipped: { card_1: { passiveEffects: [effect("lifesteal", 20)] },
        weapon: { enchantments: [{ effectKey: "lifesteal", value: 7 }] } } }); assertHealing(r, 64);
    });
    await check("boss and world-boss lethal ordinary hit retain lifesteal", () => {
      for (const options of [{ monsterIsBoss: true }, { monsterIsBoss: true, zone: "world_boss" }]) {
        const r = battle(ring, { hp: 200, options }); assert.equal(r.outcome, "win"); assertHealing(r, 30);
      }
    });
  } finally { Math.random = originalRandom; }
  const report = { at: new Date().toISOString(), source: snapshot || "fixtures", battles,
    hashes: { combatLoop: digest(path.join(__dirname, "../src/shared/combatLoop.js")),
      ...(snapshot ? { items: digest(path.join(snapshot, "items.bson")), monsters: digest(path.join(snapshot, "monsters.bson")) } : {}) },
    checks, failures: checks.filter(c => !c.ok) };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.error ? `: ${c.error}` : ""}`);
  console.log(`${checks.length - report.failures.length}/${checks.length} checks; ${battles} battles`);
  if (report.failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
