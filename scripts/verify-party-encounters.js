"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { loadBson } = require("./verify-normal-progression");
const { MonsterService } = require("../src/services/monster/monsterService");
const encounters = require("../src/shared/partyTowerEncounters");
const rules = require("../src/shared/partyTowerRules");
async function main() {
  const snapshot = process.argv.find(v => v.startsWith("--snapshot="))?.slice(11);
  const output = process.argv.find(v => v.startsWith("--output="))?.slice(9);
  if (!snapshot || !output) throw Error("snapshot and output required");
  const all = await new MonsterService({ findAll: async () => loadBson(`${snapshot}/monsters.bson`) }).listMonsters();
  const rows = [], checks = [];
  function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: e.message }); } }
  for (const key of ["normal", "challenge"]) for (let floor = 1; floor <= rules.difficulty(key).totalFloors; floor++) {
    const plan = encounters.encounterPlan(key, floor), pool = encounters.encounterPool(all, key, floor);
    const row = { key, floor, segment: plan.label, target: plan.target, candidates: pool.map(m => ({ id: m.id, name: m.name, zone: m.zone, level: m.level, boss: m.isBoss })) }; rows.push(row);
    check(`${key} ${floor}樓有實際怪物且沒有新手／世界／活動／停用來源`, () => {
      assert.ok(pool.length); for (const m of pool) { assert.ok(m.level >= (key === "challenge" ? 40 : 20)); assert.notEqual(m.enabled, false); assert.equal(Boolean(m.allZones), false); assert.equal(Boolean(m.isBoss), floor % 5 === 0); }
      for (const r of [0, .5, .9999]) assert.ok(pool.includes(encounters.pickMonster(all, key, floor, () => r)));
    });
  }
  check("停用、全區域、無區域及新手怪無法進候選池", () => {
    const good = encounters.pickMonster(all, "challenge", 1, () => 0);
    const variants = [{ ...good, enabled: false }, { ...good, allZones: true }, { ...good, zone: null }, { ...good, zone: "beginner", level: 1 }];
    assert.deepEqual(encounters.encounterPool(variants, "challenge", 1), []);
  });
  check("缺池拒絕503，沒有新手怪 fallback", () => assert.throws(() => encounters.pickMonster([], "challenge", 1), e => e.status === 503));
  check("樓層邊界拒絕", () => { for (const f of [0, 31, 1.5]) assert.throws(() => encounters.encounterPlan("normal", f)); });
  const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const report = { generatedAt: new Date().toISOString(), source: "current executable selector + fresh parse-verified live monsters snapshot", snapshotSha256: hash(`${snapshot}/monsters.bson`), sourceSha256: hash("src/shared/partyTowerEncounters.js"), rows, checks, passed: checks.every(c => c.ok) };
  fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ floors: rows.length, checks: checks.length, passed: report.passed, failures: checks.filter(c => !c.ok) })); process.exitCode = report.passed ? 0 : 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
