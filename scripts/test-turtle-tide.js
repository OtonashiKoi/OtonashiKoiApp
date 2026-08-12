"use strict";

const assert = require("node:assert/strict");
const turtle = require("../src/shared/turtleTide");
const { runCombatLoop } = require("../src/shared/combatLoop");

function hasEvent(events, type, predicate = () => true) {
  return events.some((event) => event.type === type && predicate(event));
}

// 週期流程：開戰 3 分鐘後詠唱 3 分鐘 → 海嘯 3 分鐘 → 破綻 30 秒。
{
  const t0 = Date.parse("2026-08-11T00:00:00.000Z");
  const state = {};
  assert.deepEqual(turtle.ensureCast(state, 100, t0), []);
  assert.equal(Date.parse(state.turtle.nextPeriodicAt), t0 + turtle.PERIODIC_CAST_INTERVAL_MS);

  const castEvents = turtle.ensureCast(state, 100, t0 + turtle.PERIODIC_CAST_INTERVAL_MS);
  assert.ok(hasEvent(castEvents, "castStart", (event) => event.reason === "periodic"));
  assert.equal(turtle.view(state, 100, t0 + turtle.PERIODIC_CAST_INTERVAL_MS).castRemainMs, turtle.CAST_MS, "週期觸發應從完整 3 分鐘、0% 詠唱開始");
  assert.equal(turtle.battleMods(state, "body", t0 + turtle.PERIODIC_CAST_INTERVAL_MS).mult, 0.01);
  assert.equal(turtle.battleMods(state, "body", t0 + turtle.PERIODIC_CAST_INTERVAL_MS).gaugeMult, 2);
  assert.equal(
    turtle.tsunamiRoundForBattle(state, 1000, t0 + turtle.PERIODIC_CAST_INTERVAL_MS),
    181,
    "完整三分鐘詠唱不應誤傷只有十幾回合的當前戰鬥"
  );
  assert.equal(
    turtle.tsunamiRoundForBattle(state, 1000, t0 + turtle.PERIODIC_CAST_INTERVAL_MS + turtle.CAST_MS - 2500),
    4,
    "詠唱剩 2.5 秒時應在第 4 回合開頭命中"
  );
  for (const part of ["head", "body", "wings", "legs"]) {
    const mods = turtle.battleMods(state, part, t0 + turtle.PERIODIC_CAST_INTERVAL_MS);
    assert.equal(mods.mult, 0.01, `詠唱中 ${part} 應只承受 1% 傷害`);
    assert.equal(mods.headBlocked, false, `詠唱中 ${part} 不應被潮汐封鎖`);
  }

  const castEnd = t0 + turtle.PERIODIC_CAST_INTERVAL_MS + turtle.CAST_MS;
  const tsunamiEvents = turtle.ensureCast(state, 100, castEnd);
  assert.ok(hasEvent(tsunamiEvents, "tsunami"));
  assert.equal(turtle.battleMods(state, "body", castEnd).tsunami, true);

  const tsunamiEnd = castEnd + turtle.TSUNAMI_MS;
  const breachEvents = turtle.ensureCast(state, 100, tsunamiEnd);
  assert.ok(hasEvent(breachEvents, "breachStart", (event) => event.reason === "tsunami_end"));
  assert.equal(turtle.battleMods(state, "head", tsunamiEnd).mult, 1.3);
  assert.equal(turtle.battleMods(state, "head", tsunamiEnd).headBlocked, false);

  const breachEnd = tsunamiEnd + turtle.BREACH_MS;
  turtle.ensureCast(state, 100, breachEnd);
  assert.equal(turtle.view(state, 100, breachEnd).breach, false);
  // t=6、9 分鐘的週期點都落在特殊狀態內，下一個檢查點應為 t=12 分鐘，不補發重疊海嘯。
  assert.equal(Date.parse(state.turtle.nextPeriodicAt), t0 + 12 * 60 * 1000);
}

// 已在戰鬥中的玩家：若詠唱在本場時間軸內完成，對應回合會被真海嘯截斷。
{
  const player = {
    maxHp: 1000, atk: 10, def: 10, flatDef: 0,
    str: 1, agi: 20, vit: 1, int: 1, dex: 100, luk: 1,
    hit: 100, dodge: 0, crit: 0, combo: 0,
    comboDamageMultiplier: 1, dmgMin: 1, dmgMax: 1,
    weaponType: "sword_1h", finalDamageMultiplier: 1,
  };
  const monster = {
    maxHp: 999999, atk: 0, def: 0, flatDef: 0,
    str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1,
    hit: 0, dodge: 0, critRate: 0, critDamage: 1.5,
  };
  const result = runCombatLoop(player, monster, "島島龜王", monster.maxHp, 5, {
    equipped: {}, inventory: [], tsunamiDeathRound: 3,
  });
  assert.equal(result.outcome, "lose");
  assert.equal(result.finalPlayerHp, 0);
  assert.equal(result.nextRound, 3, "海嘯應在第 3 回合截斷正在進行的戰鬥");
  assert.match(result.roundLogs[2], /第 3 回合/);
  assert.match(result.roundLogs[2], /戰鬥途中完成詠唱/);
}

// 固定血線：70% 與 30% 各一次；忙碌中跨 30% 會排隊，破綻結束後優先發動。
{
  const t0 = Date.parse("2026-08-11T01:00:00.000Z");
  const state = {};
  turtle.ensureCast(state, 100, t0);

  const at70 = turtle.ensureCast(state, 70, t0 + 60 * 1000);
  assert.ok(hasEvent(at70, "castStart", (event) => event.reason === "fixed_70"));
  assert.equal(turtle.view(state, 70, t0 + 60 * 1000).castRemainMs, turtle.CAST_MS, "70% 固定觸發應把詠唱條歸零");
  assert.equal(state.turtle.forced70Triggered, true);

  const at30WhileCasting = turtle.ensureCast(state, 30, t0 + 2 * 60 * 1000);
  assert.ok(hasEvent(at30WhileCasting, "fixedCastQueued", (event) => event.threshold === 30));
  assert.deepEqual(state.turtle.pendingForcedCasts, [30]);

  assert.equal(turtle.interrupt(state, "測試冰封", t0 + 150 * 1000), true);
  assert.equal(turtle.view(state, 30, t0 + 150 * 1000).breachReason, "interrupt");
  assert.equal(turtle.battleMods(state, "body", t0 + 150 * 1000).mult, 1.3);

  const afterBreach = turtle.ensureCast(state, 30, t0 + 180 * 1000);
  assert.ok(hasEvent(afterBreach, "castStart", (event) => event.reason === "fixed_30"));
  assert.equal(turtle.view(state, 30, t0 + 180 * 1000).castRemainMs, turtle.CAST_MS, "30% 固定觸發應把詠唱條歸零");
  assert.deepEqual(state.turtle.pendingForcedCasts, []);

  // 同一輪持續低於血線不會再次排固定詠唱。
  const repeated = turtle.ensureCast(state, 25, t0 + 181 * 1000);
  assert.equal(hasEvent(repeated, "fixedCastQueued"), false);
}

// 新一輪回滿血會清除固定觸發旗標並重新開始三分鐘週期。
{
  const t0 = Date.parse("2026-08-11T02:00:00.000Z");
  const state = {};
  turtle.ensureCast(state, 60, t0);
  assert.equal(state.turtle.forced70Triggered, true);
  turtle.ensureCast(state, 100, t0 + 10 * 60 * 1000);
  assert.equal(state.turtle.forced70Triggered, false);
  assert.equal(Date.parse(state.turtle.nextPeriodicAt), t0 + 13 * 60 * 1000);
}

console.log("turtle tide tests: OK");
