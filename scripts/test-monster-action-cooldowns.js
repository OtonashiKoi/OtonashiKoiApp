"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { deserialize } = require("bson");
const { NormalLiveCombat } = require("../src/services/realtime/normalLiveCombat");
const { ZoneCombatScene } = require("../src/services/realtime/zoneCombatScene");
const { MonsterService } = require("../src/services/monster/monsterService");
const { calculateBattleTickMs } = require("../src/shared/battleTiming");
const { beginMonsterAction } = require("../src/services/realtime/monsterActionClock");
const { buildCompanion } = require("../src/services/realtime/starterCompanions");
const { NORMAL_ZONES } = require("../src/shared/encounterGroup");

function readBson(file) {
  const bytes = fs.readFileSync(file), rows = [];
  for (let offset = 0; offset < bytes.length;) {
    const size = bytes.readInt32LE(offset);
    rows.push(deserialize(bytes.subarray(offset, offset + size))); offset += size;
  }
  return rows;
}

const playerStats = { atk: 5, maxHp: 100000, agi: 5, dex: 20, level: 30,
  int: 0, def: 0, flatDef: 0, hit: 100, dodge: 0, crit: 0, dmgMin: 1, dmgMax: 1 };
function fixture(monster, items = []) {
  let now = 1000, fail = false;
  let state = { activeMonsterSeq: monster.seq, normalLiveSpawnAt: 100, currentHp: monster.calc.maxHp,
    encounterCount: 1, encounterMonsterSeq: monster.seq, damageMap: {}, participants: [] };
  let engine;
  const packets = [], pending = [], zone = monster.zone;
  const sc = { itemService: { listItems: async () => items }, monsterService: {
    getState: async () => structuredClone(state),
    saveStateIfActiveMonster: async (next, z, seq, expected) => {
      assert.equal(z, zone); assert.equal(seq, state.activeMonsterSeq); assert.equal(expected, state.currentHp);
      if (fail) return false;
      state = structuredClone(next); return true;
    },
  } };
  function createEngine(starterNpcs = false) {
    engine = new NormalLiveCombat({ now: () => now, auto: false, starterNpcs,
      scene: new ZoneCombatScene({ now: () => now, emit: () => {} }),
      emit: (actorId, event) => packets.push({ actorId, ...event }) });
  }
  createEngine();
  async function join(id, stats = {}, extraOptions = {}) {
    const p = engine.join({ sc, zone, monster, actorId: id, actorName: id,
      stats: { ...playerStats, ...stats }, monsterStats: monster.calc,
      options: { playerName: id, playerLevel: 30, equipped: {}, inventory: [],
        monsterIsBoss: !!monster.isBoss, monsterEquipped: monster.equipment || {}, ...extraOptions } });
    p.catch(() => {}); pending.push(p); await engine.queues.get(zone);
    engine.players.get(id).attackAt = Infinity;
  }
  async function pulse(turn, hp = 20000) {
    state.currentHp = hp; now = state.normalLiveSpawnAt + turn * calculateBattleTickMs(monster.calc.agi);
    await engine.advance(zone);
    return packets.filter(p => p.type === "normal_live_action" && p.data.at === now);
  }
  function stop() { const room = engine.zones.get(zone); if (room && !room.closed) engine.failRoom(room, Error("fixture end")); }
  async function close() { stop(); await Promise.allSettled(pending); }
  return { join, pulse, close, stop, createEngine, packets, sc, monster,
    engine: () => engine, state: () => state, time: value => { now = value; },
    replaceState: value => { state = structuredClone(value); }, fail: () => { fail = true; } };
}
const cast = packet => packet.data.logs.join("\n").includes("發動【石化再生】");
const casts = (packets, actorId) => packets.filter(p => p.actorId === actorId && cast(p));

(async () => {
  const snapshot = process.argv[2];
  if (!snapshot) throw Error("Usage: node scripts/test-monster-action-cooldowns.js VERIFIED_SNAPSHOT [REPORT]");
  const monsters = readBson(path.join(snapshot, "monsters.bson")), items = readBson(path.join(snapshot, "items.bson"));
  const raw = monsters.find(m => m.name === "城堡魔像(B)"); assert.ok(raw);
  const service = new MonsterService({ findById: async () => raw });
  const monster = await service.getMonsterById(raw.id);
  const key = monster.equipment.special_1.itemId, heal = Math.round(monster.calc.maxHp * 0.25);
  assert.equal(monster.equipment.special_1.monsterCardSkill.cooldownTurns, 5);
  const checks = [], oldRandom = Math.random; Math.random = () => 0.5;
  const check = async (name, work) => {
    try { await work(); checks.push({ name, ok: true }); console.log("PASS", name); }
    catch (error) { checks.push({ name, ok: false, error: error.stack }); console.error("FAIL", name, error.message); }
  };
  try {
    await check("all six live normal-map cooldown skills use their monster cadence for early and late participants", async () => {
      Math.random = () => 0;
      const candidates = monsters.filter(m => m.id && m.enabled && NORMAL_ZONES.has(m.zone)
        && m.equipment?.special_1?.monsterCardSkill?.cooldownTurns > 0);
      assert.equal(candidates.length, 6);
      try {
        for (const rawMonster of candidates) {
          const m = await new MonsterService({ findById: async () => rawMonster }).getMonsterById(rawMonster.id);
          const cooldown = m.equipment.special_1.monsterCardSkill.cooldownTurns, cardKey = m.equipment.special_1.itemId;
          const f = fixture(m), turns = [];
          await f.join("A"); await f.join("B");
          try {
            for (let turn = 1; turn <= 1 + 2 * cooldown; turn++) {
              if (turn === 2) await f.join("C");
              await f.pulse(turn, Math.max(1, Math.floor(m.calc.maxHp * 0.25)));
              const ready = f.state().normalLive.monster.skillReadyTurns[cardKey];
              if (ready === turn + cooldown) turns.push(turn);
              for (const actor of f.engine().players.values()) {
                assert.equal(actor.result.cardCooldowns.monster[cardKey], Math.max(0, ready - turn), m.name + " " + actor.actorId);
              }
            }
            assert.deepEqual(turns, [1, 1 + cooldown, 1 + 2 * cooldown], m.name);
          } finally { await f.close(); }
        }
      } finally { Math.random = () => 0.5; }
    });
    await check("castle B uses real max HP, decays once per shared cast, and stays at 10%", async () => {
      const f = fixture(monster), turns = []; await f.join("A");
      try {
        for (let t = 1; t <= 31; t++) {
          if (t === 12) await f.join("late");
          const packets = await f.pulse(t);
          if (casts(packets, "A").length) { turns.push(t); assert.equal(f.state().currentHp, 20000 + Math.round(monster.calc.maxHp * [25, 20, 15, 12.5, 10][Math.min(turns.length - 1, 4)] / 100)); }
          else assert.equal(f.state().currentHp, 20000);
          assert.equal(f.state().normalLive.monster.skillTriggerCounts[key], turns.length);
        }
        assert.deepEqual(turns, [1, 6, 11, 16, 21, 26, 31]);
      } finally { await f.close(); }
    });
    await check("fast player attacks preserve monster cooldown; personal cards still tick on player actions", async () => {
      const f = fixture(monster); await f.join("A", { agi: 40 });
      try {
        assert.equal(casts(await f.pulse(1), "A").length, 0);
        assert.equal(casts(await f.pulse(2), "A").length, 1);
        const actor = f.engine().players.get("A"); actor.result.cardCooldowns.player.personal = 5;
        const saved = structuredClone(f.state().normalLive.monster);
        f.time(100 + 2 * calculateBattleTickMs(monster.calc.agi) + 10);
        for (let i = 0; i < 4; i++) {
          actor.attackAt = 0; await f.engine().advance(monster.zone);
          assert.deepEqual(f.state().normalLive.monster, saved);
          assert.equal(actor.result.cardCooldowns.monster[key], 5);
        }
        assert.equal(actor.result.cardCooldowns.player.personal, 1);
        await f.pulse(3); assert.equal(actor.result.cardCooldowns.player.personal, 1);
        const turns = [2];
        for (let t = 4; t <= 14; t++) if (casts(await f.pulse(t), "A").length) turns.push(t);
        assert.deepEqual(turns, [2, 8, 14]);
      } finally { await f.close(); }
    });
    await check("late participant shares cooldown and full-HP healing after the first participant dies", async () => {
      const f = fixture(monster); await f.join("A");
      try {
        await f.pulse(1); await f.join("B");
        f.engine().players.get("A").hp = 1;
        for (let t = 2; t < 6; t++) assert.equal(casts(await f.pulse(t), "B").length, 0);
        assert.equal(f.engine().players.has("A"), false);
        assert.equal(casts(await f.pulse(6), "B").length, 1);
        assert.equal(f.state().normalLive.monster.skillTriggerCounts[key], 2);
        assert.equal(f.state().currentHp, 20000 + Math.round(monster.calc.maxHp * .20));
        assert.equal(f.state().normalLive.monster.skillReadyTurns[key], 11);
      } finally { await f.close(); }
    });
    await check("one shared heal even with 50 targets; first suppressed target cannot discard another target's heal", async () => {
      const f = fixture(monster); await f.join("A", { agi: 40 });
      for (let i = 0; i < 49; i++) await f.join("B" + i);
      try {
        const packets = await f.pulse(1);
        assert.equal(casts(packets, "A").length, 0); assert.equal(packets.filter(cast).length, 49);
        assert.equal(f.state().currentHp, 20000 + heal);
        assert.equal(f.state().normalLive.monster.skillReadyTurns[key], 6);
        assert.equal((await f.pulse(2)).filter(cast).length, 0);
      } finally { await f.close(); }
    });
    await check("low-HP regeneration keeps all counter damage and living actor state instead of clamping before healing", async () => {
      const f = fixture(monster), options = { playerActiveEffects: [{ key: "counter_attack", params: { value: 100 } }] };
      await f.join("A", { atk: 1000 }, options); await f.join("B", { atk: 1000 }, options);
      try {
        await f.pulse(1, 1);
        const damage = [...f.engine().players.values()].reduce((sum, a) => sum + a.result.totalDamage, 0);
        assert.ok(damage > 1 && damage < heal);
        assert.equal(f.state().currentHp, 1 + heal - damage);
        assert.ok(Object.values(f.state().normalLive.actors).every(a => a.active));
        assert.equal(f.state().normalLive.monster.skillReadyTurns[key], 6);
      } finally { await f.close(); }
    });
    await check("three existing lifesteal monsters retain one heal for one or fifty targets", async () => {
      for (const name of ["小史(小)", "小史(中)", "林地妖靈(樹樹)"]) {
        const rawMonster = monsters.find(m => m.name === name);
        const m = await new MonsterService({ findById: async () => rawMonster }).getMonsterById(rawMonster.id);
        // A controlled attack makes even the STR 1 slime's 15% heal measurable.
        // The existing lifesteal effect is installed as an already-active buff.
        m.calc.atk = 100;
        const effect = m.equipment.special_1.monsterCardSkill.procEffects.find(e => e.key === "lifesteal");
        assert.ok(effect);
        const outcomes = [], start = Math.floor(m.calc.maxHp / 4);
        for (const count of [1, 50]) {
          const f = fixture(m);
          try {
            for (let i = 0; i < count; i++) {
              const id = "A" + i;
              await f.join(id, { agi: m.calc.agi, level: m.level }, { playerLevel: m.level });
              f.engine().players.get(id).result = { monsterActiveEffects: [{ ...structuredClone(effect), appliedAt: 1 }] };
            }
            await f.pulse(1, start);
            outcomes.push(f.state().currentHp);
            assert.ok(f.state().currentHp > start, name + " must actually heal");
            assert.ok(f.state().currentHp < m.calc.maxHp);
          } finally { await f.close(); }
        }
        assert.equal(outcomes[0], outcomes[1], name + " duplicate lifesteal healing");
      }
    });
    await check("empty room, leave, and new runtime keep the monster clock and remaining cooldown", async () => {
      const f = fixture(monster); await f.join("A");
      try {
        await f.pulse(1);
        const id = f.engine().status("A").liveBattleId;
        await f.engine().leave("A", id);
        f.time(100 + 4 * calculateBattleTickMs(monster.calc.agi)); f.createEngine(); await f.join("B");
        assert.equal(casts(await f.pulse(5), "B").length, 0);
        assert.equal(casts(await f.pulse(6), "B").length, 1);
        assert.equal(f.state().currentHp, 20000 + Math.round(monster.calc.maxHp * .20));
        assert.equal(f.state().normalLive.monster.skillTriggerCounts[key], 2);
      } finally { await f.close(); }
    });
    await check("lagged pulses use elapsed monster turns and duplicate processing never casts twice", async () => {
      const f = fixture(monster); await f.join("A");
      try {
        await f.pulse(1); assert.equal(casts(await f.pulse(5), "A").length, 0);
        assert.equal(casts(await f.pulse(6), "A").length, 1);
        const before = structuredClone(f.state()), count = f.packets.length;
        await f.engine().advance(monster.zone);
        assert.deepEqual(f.state(), before); assert.equal(f.packets.length, count);
      } finally { await f.close(); }
    });
    await check("failed HP CAS cannot publish or persist a skill cooldown", async () => {
      const f = fixture(monster); await f.join("A");
      try {
        f.state().currentHp = 20000; const before = structuredClone(f.state()), packets = f.packets.length;
        f.fail(); await f.pulse(1);
        assert.deepEqual(f.state(), before);
        assert.equal(f.packets.slice(packets).filter(p => p.type === "normal_live_action").length, 0);
      } finally { await f.close(); }
    });
    await check("new encounter and separate monsters do not inherit another monster's cooldown", async () => {
      const f = fixture(monster); await f.join("A");
      try {
        await f.pulse(1); f.stop();
        const next = structuredClone(f.state()); next.killCount = { respawns: 1 }; next.normalLiveSpawnAt = 2000;
        next.currentHp = monster.calc.maxHp; f.replaceState(next); f.time(2100); f.createEngine(); await f.join("B");
        assert.equal(casts(await f.pulse(1), "B").length, 1);
        const independent = fixture({ ...monster, zone: "mid" }); await independent.join("C");
        try { assert.equal(casts(await independent.pulse(1), "C").length, 1); }
        finally { await independent.close(); }
      } finally { await f.close(); }
    });
    await check("existing actor snapshots migrate once, then monster cooldown survives without actor data", async () => {
      const room = { zone: monster.zone, seq: monster.seq, monster, epoch: 100, enemyTick: 1397 };
      const state = { activeMonsterSeq: monster.seq, normalLive: { encounterKey: `${monster.zone}:${monster.seq}:0`,
        actors: { A: { lastAt: 1497, result: { cardCooldowns: { monster: { [key]: 5 } } } } } } };
      const clock = beginMonsterAction(room, state, 2894, true);
      assert.equal(clock.cooldowns[key], 4); assert.equal(clock.readyTurns[key], 6);
      state.normalLive.monster = { skillReadyTurns: clock.readyTurns }; state.normalLive.actors = {};
      assert.equal(beginMonsterAction(room, state, 5688, true).cooldowns[key], 2);
    });
    await check("production Mongo CAS adapter durably stores one shared cooldown across runtime recreation", async () => {
      require("dotenv").config({ quiet: true });
      const { MongoClient } = require("mongodb");
      const { saveActiveMonsterState } = require("../src/adapters/mongo/saveActiveMonsterState");
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const db = client.db("qa_monster_clock_" + Date.now()), f = fixture(monster);
      assert.ok(db.databaseName.startsWith("qa_monster_clock_"));
      const canonical = db.collection("monsters"), legacy = db.collection("monsterState");
      try {
        await canonical.insertOne({ _id: `monsterState:${monster.zone}`, value: f.state() });
        await legacy.insertOne({ _id: monster.zone, value: f.state() });
        f.sc.monsterService.getState = async () => {
          const value = (await canonical.findOne({ _id: `monsterState:${monster.zone}` })).value;
          f.replaceState(value); return value;
        };
        f.sc.monsterService.saveStateIfActiveMonster = async (state, zoneKey, expectedMonsterSeq, expectedCurrentHp) => {
          const saved = await saveActiveMonsterState({ collection: async name => db.collection(name),
            state, zoneKey, expectedMonsterSeq, expectedCurrentHp });
          if (saved) f.replaceState(state); return saved;
        };
        const lowHp = async () => {
          await canonical.updateOne({ _id: `monsterState:${monster.zone}` }, { $set: { "value.currentHp": 20000 } });
          await legacy.updateOne({ _id: monster.zone }, { $set: { "value.currentHp": 20000 } });
        };
        await f.join("A"); await lowHp(); await f.pulse(1);
        const saved = (await canonical.findOne({ _id: `monsterState:${monster.zone}` })).value;
        assert.equal(saved.normalLive.monster.skillReadyTurns[key], 6);
        assert.equal(saved.currentHp, 20000 + heal);
        assert.deepEqual((await legacy.findOne({ _id: monster.zone })).value.normalLive.monster, saved.normalLive.monster);
        f.stop(); f.createEngine(); await f.join("B");
        await lowHp(); assert.equal(casts(await f.pulse(2), "B").length, 0);
        await lowHp(); assert.equal(casts(await f.pulse(6), "B").length, 1);
        const after = (await canonical.findOne({ _id: `monsterState:${monster.zone}` })).value;
        assert.equal(after.normalLive.monster.skillReadyTurns[key], 11);
        assert.equal(after.currentHp, 20000 + Math.round(monster.calc.maxHp * .20));
      } finally { await f.close(); await db.dropDatabase(); await client.close(); }
    });
    await check("NPC targets share the same monster cooldown and never multiply its heal", async () => {
      const f = fixture(monster, items); f.sc.monsterService.listMonsters=async()=>monsters; f.createEngine(true); await f.join("A", { agi: 40 });
      try {
        f.state().damageMap.A = { damage: 1 };
        const first = await f.pulse(1); assert.equal(casts(first, "A").length, 0);
        assert.equal(f.state().currentHp, 20000 + heal);
        assert.equal(f.state().normalLive.monster.skillReadyTurns[key], 6);
        const room = f.engine().zones.get(monster.zone);
        // The fast human/rogue suppress the first attack; the fully equipped
        // INT-focused barrier mage does not. Its heal must start the shared CD.
        assert.ok(room.companions.some(n => n.result?.roundLogs.join("\n").includes("發動【石化再生】")));
        const packets = await f.pulse(2); assert.equal(casts(packets, "A").length, 0);
        assert.equal(f.state().currentHp, 20000);
        for (const npc of room.companions) assert.equal(npc.result.cardCooldowns.monster[key], 4);
        await f.pulse(6); assert.equal(f.state().currentHp, 20000 + Math.round(monster.calc.maxHp * .20));
        assert.equal(f.state().normalLive.monster.skillReadyTurns[key], 11);
        assert.ok(buildCompanion("barrier-mage", "ancient_city", items, monsters).stats.maxHp > 0);
      } finally { await f.close(); }
    });
  } finally { Math.random = oldRandom; }
  const sources = ["src/services/realtime/normalLiveCombat.js", "src/services/realtime/monsterActionClock.js",
    "src/services/realtime/starterCompanionCombat.js", "src/shared/combatLoop.js"].map(file => ({ file,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, "..", file))).digest("hex") }));
  const report = { at: new Date().toISOString(), source: snapshot,
    method: "Actual monster definitions and production combat engine; controlled low-HP pulses isolate cooldowns; in-memory rooms plus an isolated Mongo database",
    rng: { defaultConstant: 0.5, allSkillCadenceConstant: 0 },
    lifestealControl: "Real three monster definitions, with ATK 100 and an already-active real lifesteal effect to make the heal measurable",
    monster: { id: raw.id, name: raw.name,
    maxHp: monster.calc.maxHp, agi: monster.calc.agi, cooldownTurns: 5 }, checks, sources,
    ok: checks.every(c => c.ok) };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
