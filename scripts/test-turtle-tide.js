"use strict";

const assert = require("node:assert/strict");
const turtle = require("../src/shared/turtleTide");
const { STUN_WINDOW_MS } = require("../src/shared/dwarfStunGauge");
const { runCombatLoop } = require("../src/shared/combatLoop");

function hasEvent(events, type, predicate = () => true) {
  return events.some((event) => event.type === type && predicate(event));
}

// 巨神震擊：詠唱歸零，暈眩期間不詠唱，結束後重跑完整 3 分鐘，且不開破綻。
{
  const t0 = Date.parse("2026-08-11T00:30:00.000Z");
  const state = {};
  turtle.ensureCast(state, 100, t0);
  turtle.ensureCast(state, 70, t0 + 60 * 1000);

  const stunnedAt = t0 + 2 * 60 * 1000;
  const stunnedUntil = stunnedAt + STUN_WINDOW_MS;
  assert.equal(turtle.resetCastAfterStun(state, "測試巨神震擊", stunnedUntil, stunnedAt), true);

  const duringStun = turtle.view(state, 70, stunnedAt);
  assert.equal(duringStun.castPaused, true);
  assert.equal(duringStun.casting, false);
  assert.equal(duringStun.castRemainMs, 0, "暈眩期間詠唱條應顯示為歸零");
  assert.equal(duringStun.breach, false, "巨神震擊不應開啟破綻");
  assert.equal(turtle.battleMods(state, "body", stunnedAt).casting, false, "暈眩期間不應套用詠唱 1% 減傷");

  const resumed = turtle.view(state, 70, stunnedUntil);
  assert.equal(resumed.castPaused, false);
  assert.equal(resumed.casting, true);
  assert.equal(resumed.castRemainMs, turtle.CAST_MS, "暈眩結束後應從完整詠唱條重新計算");
  assert.equal(turtle.battleMods(state, "body", stunnedUntil).mult, turtle.CAST_DAMAGE_MULT);

  const castEnd = stunnedUntil + turtle.CAST_MS;
  const events = turtle.ensureCast(state, 70, castEnd);
  assert.ok(hasEvent(events, "tsunami"), "重新計算的詠唱完成後仍應發動海嘯");
}

// 同時結算的舊戰鬥若把詠唱重置蓋回去，須能靠獨立暈眩文件的時間戳自動修復。
{
  const t0 = Date.parse("2026-08-11T00:40:00.000Z");
  const castStartedAt = t0 + 60 * 1000;
  const stunnedAt = castStartedAt + 60 * 1000;
  const stunnedUntil = stunnedAt + STUN_WINDOW_MS;
  const stale = {};
  turtle.ensureCast(stale, 100, t0);
  turtle.ensureCast(stale, 70, castStartedAt);
  assert.equal(turtle.view(stale, 70, stunnedAt).casting, true);

  assert.equal(
    turtle.reconcileCastAfterStun(stale, "測試巨神震擊", stunnedUntil, stunnedAt, stunnedAt + 1000),
    true,
    "舊 monsterState 蓋回詠唱時應自動修復"
  );
  const repairedDuringStun = turtle.view(stale, 70, stunnedAt + 1000);
  assert.equal(repairedDuringStun.casting, false);
  assert.equal(repairedDuringStun.castPaused, true, "暈眩期間詠唱讀條必須消失");
  assert.equal(turtle.view(stale, 70, stunnedUntil).castRemainMs, turtle.CAST_MS);
  assert.equal(
    turtle.reconcileCastAfterStun(stale, "測試巨神震擊", stunnedUntil, stunnedAt, stunnedAt + 2000),
    false,
    "同一次暈眩不可重複延後詠唱"
  );
}

// 暈眩結束後才合法開始的新詠唱，不可被舊暈眩記錄誤重置。
{
  const t0 = Date.parse("2026-08-11T00:50:00.000Z");
  const stunnedAt = t0 + 10 * 1000;
  const stunnedUntil = stunnedAt + STUN_WINDOW_MS;
  const state = {};
  turtle.ensureCast(state, 100, t0);
  state.turtle.castingUntil = new Date(stunnedUntil + 30 * 1000 + turtle.CAST_MS).toISOString();
  assert.equal(
    turtle.reconcileCastAfterStun(state, "測試巨神震擊", stunnedUntil, stunnedAt, stunnedUntil + 40 * 1000),
    false
  );
}

// 滿血不論經過多久都不會詠唱；70% 才開始詠唱 3 分鐘 → 海嘯 3 分鐘 → 破綻 30 秒。
{
  const t0 = Date.parse("2026-08-11T00:00:00.000Z");
  const state = {};
  assert.deepEqual(turtle.ensureCast(state, 100, t0), []);
  assert.equal(state.turtle.nextPeriodicAt, undefined);
  assert.deepEqual(turtle.ensureCast(state, 100, t0 + 60 * 60 * 1000), []);
  assert.equal(turtle.view(state, 100, t0 + 60 * 60 * 1000).casting, false);

  const castStartedAt = t0 + 60 * 60 * 1000 + 1000;
  const castEvents = turtle.ensureCast(state, 70, castStartedAt);
  assert.ok(hasEvent(castEvents, "castStart", (event) => event.reason === "fixed_70"));
  assert.equal(turtle.view(state, 70, castStartedAt).castRemainMs, turtle.CAST_MS, "70% 觸發應從完整 3 分鐘、0% 詠唱開始");
  assert.equal(turtle.battleMods(state, "body", castStartedAt).mult, 0.01);
  assert.equal(turtle.battleMods(state, "body", castStartedAt).gaugeMult, 2);
  assert.equal(
    turtle.tsunamiRoundForBattle(state, 1000, castStartedAt),
    181,
    "完整三分鐘詠唱不應誤傷只有十幾回合的當前戰鬥"
  );
  assert.equal(
    turtle.tsunamiRoundForBattle(state, 1000, castStartedAt + turtle.CAST_MS - 2500),
    4,
    "詠唱剩 2.5 秒時應在第 4 回合開頭命中"
  );
  for (const part of ["head", "body", "wings", "legs"]) {
    const mods = turtle.battleMods(state, part, castStartedAt);
    assert.equal(mods.mult, 0.01, `詠唱中 ${part} 應只承受 1% 傷害`);
    assert.equal(mods.headBlocked, false, `詠唱中 ${part} 不應被潮汐封鎖`);
  }

  const castEnd = castStartedAt + turtle.CAST_MS;
  const tsunamiEvents = turtle.ensureCast(state, 70, castEnd);
  assert.ok(hasEvent(tsunamiEvents, "tsunami"));
  assert.equal(turtle.battleMods(state, "body", castEnd).tsunami, true);

  const tsunamiEnd = castEnd + turtle.TSUNAMI_MS;
  const breachEvents = turtle.ensureCast(state, 70, tsunamiEnd);
  assert.ok(hasEvent(breachEvents, "breachStart", (event) => event.reason === "tsunami_end"));
  assert.equal(turtle.battleMods(state, "head", tsunamiEnd).mult, 1.3);
  assert.equal(turtle.battleMods(state, "head", tsunamiEnd).headBlocked, false);

  const breachEnd = tsunamiEnd + turtle.BREACH_MS;
  turtle.ensureCast(state, 70, breachEnd);
  assert.equal(turtle.view(state, 70, breachEnd).breach, false);
  assert.equal(turtle.view(state, 70, breachEnd).casting, false, "70% 同一輪只會觸發一次");
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

// 固定血線：70% 與 40% 各一次；忙碌中跨 40% 會排隊，破綻結束後優先發動。
{
  const t0 = Date.parse("2026-08-11T01:00:00.000Z");
  const state = {};
  turtle.ensureCast(state, 100, t0);

  const at70 = turtle.ensureCast(state, 70, t0 + 60 * 1000);
  assert.ok(hasEvent(at70, "castStart", (event) => event.reason === "fixed_70"));
  assert.equal(turtle.view(state, 70, t0 + 60 * 1000).castRemainMs, turtle.CAST_MS, "70% 固定觸發應把詠唱條歸零");
  assert.equal(state.turtle.forced70Triggered, true);

  const at40WhileCasting = turtle.ensureCast(state, 40, t0 + 2 * 60 * 1000);
  assert.ok(hasEvent(at40WhileCasting, "fixedCastQueued", (event) => event.threshold === 40));
  assert.deepEqual(state.turtle.pendingForcedCasts, [40]);

  assert.equal(turtle.interrupt(state, "測試冰封", t0 + 150 * 1000), true);
  assert.equal(turtle.view(state, 40, t0 + 150 * 1000).breachReason, "interrupt");
  assert.equal(turtle.battleMods(state, "body", t0 + 150 * 1000).mult, 1.3);

  const afterBreach = turtle.ensureCast(state, 40, t0 + 180 * 1000);
  assert.ok(hasEvent(afterBreach, "castStart", (event) => event.reason === "fixed_40"));
  assert.equal(turtle.view(state, 40, t0 + 180 * 1000).castRemainMs, turtle.CAST_MS, "40% 固定觸發應把詠唱條歸零");
  assert.deepEqual(state.turtle.pendingForcedCasts, []);

  // 同一輪持續低於血線不會再次排固定詠唱。
  const repeated = turtle.ensureCast(state, 35, t0 + 181 * 1000);
  assert.equal(hasEvent(repeated, "fixedCastQueued"), false);
}

// 新一輪回滿血會清除固定觸發旗標，但不建立任何週期詠唱。
{
  const t0 = Date.parse("2026-08-11T02:00:00.000Z");
  const state = {};
  turtle.ensureCast(state, 60, t0);
  assert.equal(state.turtle.forced70Triggered, true);
  turtle.ensureCast(state, 100, t0 + 10 * 60 * 1000);
  assert.equal(state.turtle.forced70Triggered, false);
  assert.equal(state.turtle.forced40Triggered, false);
  assert.equal(state.turtle.nextPeriodicAt, undefined);
  assert.equal(turtle.view(state, 100, t0 + 60 * 60 * 1000).casting, false);
}

// 舊 v2 的週期詠唱狀態升級後必須立即清除，滿血不可延續 periodic 詠唱。
{
  const now = Date.parse("2026-08-11T03:00:00.000Z");
  const state = {
    turtle: {
      rulesVersion: 2,
      encounterStartedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      nextPeriodicAt: new Date(now + 60 * 1000).toISOString(),
      castingUntil: new Date(now + turtle.CAST_MS).toISOString(),
      lastCastReason: "periodic",
      lastHpPct: 100,
    },
  };
  assert.deepEqual(turtle.ensureCast(state, 100, now), []);
  assert.equal(state.turtle.rulesVersion, turtle.RULES_VERSION);
  assert.equal(state.turtle.castingUntil, null);
  assert.equal(state.turtle.nextPeriodicAt, undefined);
  assert.equal(state.turtle.lastCastReason, null);
}

console.log("turtle tide tests: OK");
