"use strict";
const assert = require("node:assert/strict");
const { checkZoneLevelRequirementWithBinding } = require("../src/shared/zones");
const { buildPlan, REVISION } = require("./lib/normal-progression-balance");

for (const [zone, gate] of [["mid", 10], ["ancient_city", 20], ["mistwood", 30], ["ancient_city_deep", 40], ["elite", 40], ["dragon_realm", 40], ["hellfire", 40]]) {
  assert.ok(checkZoneLevelRequirementWithBinding(zone, gate - 1, null));
  assert.equal(checkZoneLevelRequirementWithBinding(zone, gate, null), null);
}
assert.ok(checkZoneLevelRequirementWithBinding("ancient_city", 20, { minLevel: 25 }));
const sample = [
  { id: "normal-a", name: "普通怪", zone: "ancient_city_deep", level: 40, enabled: true, spawnRate: 10, maxHp: 20000, expReward: 12000, str: 60, def: 100, drops: [{ itemId: "keep", chance: 2 }] },
  { id: "normal-b", name: "普通怪二", zone: "ancient_city_deep", level: 45, enabled: true, spawnRate: 10, maxHp: 30000, expReward: 18000, str: 80, def: 50 },
  { id: "boss", name: "區域王", zone: "ancient_city_deep", level: 46, enabled: true, isBoss: true, maxHp: 100000, expReward: 30000, str: 100, def: 75 },
  { id: "rare", name: "金錢怪(稀)", zone: "ancient_city_deep", level: 40, enabled: true, incomingDamageCap: 1 },
  { id: "world", name: "世界王", zone: "elite", level: 50, enabled: true, isBoss: true },
];
const saved = structuredClone(sample);
const plan = buildPlan(sample);
assert.deepEqual(sample, saved, "Planning must be read-only");
assert.equal(plan.length, 3);
assert.equal(plan[0].values.level, 30);
assert.equal(plan[1].values.level, 39);
assert.equal(plan[2].values.level, 40);
assert.ok(plan.every(p => p.values.def <= 65));
const applied = sample.map(m => ({ ...m, ...plan.find(p => p.id === m.id)?.values }));
assert.deepEqual(applied[0].drops, saved[0].drops);
assert.equal(buildPlan(applied).length, 0, "Migration must be idempotent");
assert.throws(() => buildPlan(sample.map((m, i) => i ? m : { ...m, progressionBalanceRevision: REVISION })), /Partial migration/);
console.log("PASS progression gates, binding override, migration scope, rewards, idempotency and partial-apply protection");
