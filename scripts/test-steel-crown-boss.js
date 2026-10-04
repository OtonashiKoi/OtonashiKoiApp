"use strict";
const assert = require("node:assert/strict");
const { phaseAt, attacks, splitAttacks } = require("../src/shared/steelCrownBoss");
const { runCombatLoop } = require("../src/shared/combatLoop");
const p = { maxHp:100000, atk:100, def:0, flatDef:0, str:10, agi:25, vit:10, int:10, dex:10, luk:10,
  hit:100, dodge:0, crit:0, combo:0, comboDamageMultiplier:1, dmgMin:1, dmgMax:1, weaponType:"sword_1h" };
const m = { maxHp:1500000, atk:165, def:55, flatDef:0, agi:20, dex:10, luk:10, hit:100, dodge:0, critRate:0 };
const opts = { zone:"metal_throne", monsterIsBoss:true, skipPlayerAttack:true };
function battle(hp, rounds, options = opts, stats = p, monster = m) {
  const saved = Math.random; Math.random = () => .5;
  try { return runCombatLoop({ ...stats }, { ...monster }, "赫鋼", hp, rounds, { ...options }); }
  finally { Math.random = saved; }
}
assert.equal(phaseAt(1050000,1500000),1); assert.equal(phaseAt(1049999,1500000),2);
assert.equal(phaseAt(450000,1500000),2); assert.equal(phaseAt(449999,1500000),3);
for (const [phase,hp] of [[1,1400000],[2,800000],[3,300000]]) {
  const r = battle(hp,6,opts,{...p,agi:20});
  assert.equal(r.steelCrownEvents.length,6);
  for (const e of r.steelCrownEvents) assert.deepEqual(e.hits,attacks(phase,e.action));
}
assert.deepEqual(attacks(3,6).map(x=>x.factor),[2.5,.9,.9]);
const segments = splitAttacks(attacks(3,6),165,1,1,100,3);
assert.ok(Math.abs(segments.reduce((s,x)=>s+x.factor,0)-4.3)<1e-10);
for (const [diff,count] of [[5,8],[6,7],[15,7],[16,4]]) {
  const r=battle(300000,8,opts,{...p,agi:20+diff});
  assert.equal(r.steelCrownEvents.length,count);
  assert.deepEqual(r.steelCrownEvents.map(x=>x.action),Array.from({length:count},(_,i)=>i+1));
}
assert.equal(battle(300000,8,{...opts,skipMonsterAttack:true}).steelCrownEvents.length,0);
assert.equal(battle(300000,6,{...opts,zone:"dragon_king_lair"}).steelCrownEvents,undefined);
assert.equal(battle(300000,6,{...opts,monsterIsBoss:false}).steelCrownEvents,undefined);
const crossed = battle(4300,15,{...opts,skipPlayerAttack:false},{...p,atk:1000,agi:20},{...m,maxHp:6000,def:0});
assert.ok(crossed.steelCrownEvents.some(x=>x.phase===2));
assert.ok(crossed.steelCrownEvents.some(x=>x.phase===3));
const log=battle(300000,6,opts,{...p,agi:20}).roundLogs.join("\n");
assert.ok(log.includes("爐心過載") && log.includes("浮游兵裝"));
assert.ok(!log.includes("發動【"));
console.log("PASS: 赫鋼HP邊界、跨階段、430%疊招、G6拆段、AGI計數、停止攻擊與舊區隔離");
