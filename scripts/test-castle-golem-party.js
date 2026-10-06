"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), crypto = require("node:crypto");
const { loadBson } = require("./verify-normal-progression");
require("../src/adapters/mongo/createMongoClient").getMongoDb = async () => { throw Error("Isolated test forbids live DB"); };
const { iterateFloor } = require("../src/bot/handlers/towerHandlers");
const { createLiveCombat } = require("../src/services/tower/partyTowerLiveCombat");
const snapshot = process.argv.find(a => a.startsWith("--snapshot="))?.slice(11);
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
if (!snapshot || !output) throw Error("snapshot and output required");
const raw = loadBson(snapshot + "/monsters.bson").find(m => m.monsterCardSkill?.key === "castle_golem_petrify");
const stats = { atk: 50, maxHp: 1e8, agi: 5, dex: 100, level: 30, int: 0, def: 0,
  flatDef: 0, hit: 100, dodge: 0, crit: 0, dmgMin: 1, dmgMax: 1 };
const monster = { ...raw, calc: { ...stats, maxHp: 10000, atk: 1, agi: 60, dodge: 0, critRate: 0 } };
const members = () => ["tank", "dps"].map(id => ({ discordId: id, name: id, partyV2: true,
  level: 30, towerRole: id, stats: { ...stats }, maxHp: stats.maxHp, currentHp: stats.maxHp,
  equipped: {}, inventory: [], strategy: { stance: "attack" } }));
const checks = [], old = Math.random;
async function check(name, work) { try { await work(); checks.push({ name, ok: true }); }
  catch (e) { checks.push({ name, ok: false, error: e.stack }); } }
(async () => {
  Math.random = () => .5;
  try {
    await check("real tower actions share decaying monster healing across targets and reset on a new floor", () => {
      const team = members();
      for (const floor of [1, 2]) {
        const iterator = iterateFloor({ partyV2: true, members: team, currentFloor: floor }, monster, 10000, 1);
        const heals = []; let hp = 10000;
        for (let n = 0; n < 2000 && heals.length < 7; n++) {
          const step = iterator.next(); assert.equal(step.done, false);
          const action = step.value;
          if (action.logs.some(l => l.includes("發動【石化再生】"))) heals.push(action.monsterHpAfter - hp);
          hp = action.monsterHpAfter;
        }
        iterator.return();
        assert.deepEqual(heals, [2500, 2000, 1500, 1250, 1000, 1000, 1000]);
      }
    });
    await check("tower durable replay preserves decayed healing without rerolling committed actions", () => {
      const room = { _id: "castle-decay-test", runId: "castle-decay-run", members: members() };
      const engine = createLiveCombat(); engine.initialize(room, monster, 1, 1000); room.liveCombat.seed = 937451;
      let hp = 10000, heals = 0;
      for (let n = 0; n < 2000 && heals < 5; n++) {
        const action = engine.advance(room, 1000 + n * 1000).action; assert.ok(action);
        if (action.logs.some(l => l.includes("發動【石化再生】"))) {
          const expected = [2500, 2000, 1500, 1250, 1000][heals++];
          assert.equal(action.monsterHpAfter - hp, expected);
        }
        hp = action.monsterHpAfter;
      }
      assert.equal(heals, 5);
      const saved = structuredClone(room);
      const expected = engine.advance(room, 3000000), actual = createLiveCombat().advance(saved, 3000000);
      assert.deepEqual(actual, expected); assert.deepEqual(saved.members, room.members);
    });
  } finally { Math.random = old; }
  const files = ["src/shared/combatLoop.js", "src/bot/handlers/towerHandlers.js", "src/services/realtime/monsterActionClock.js", snapshot + "/monsters.bson", snapshot + "/items.bson"];
  fs.writeFileSync(output, JSON.stringify({ source: snapshot, seed: 937451, checks,
    hashes: Object.fromEntries(files.map(p => [p, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")])) }, null, 2));
  console.log(JSON.stringify(checks)); process.exitCode = checks.every(c => c.ok) ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
