"use strict";
/**
 * 島島龜王（活動世界王）——潮汐＋海嘯詠唱，共用區域狀態機。
 *
 * 【潮汐】固定 15 分鐘週期：漲潮 10 分、退潮 5 分。
 * 【海嘯】本輪討伐開始後每 3 分鐘檢查一次；總血首次降到 70%／30% 時各強制一次。
 *   - 詠唱 3 分鐘：龜王承傷降為 1%，冰凍值／暈眩值累積 ×2。
 *   - 巨神震擊命中：詠唱條歸零，暈眩結束後重新計算完整 3 分鐘詠唱，不進入破綻。
 *   - 詠唱被區域冰封打斷：立即進入 30 秒破綻，承傷 ×1.3。
 *   - 詠唱完成：海嘯 3 分鐘，期間出戰真即死；結束後同樣進入 30 秒破綻。
 *   - 每 3 分鐘是發動檢查點；詠唱／海嘯／破綻中不重疊發動。
 *
 * 狀態存放：區域 monsterState.turtle。呼叫端必須把修改後的 monsterState 存回。
 */

const ZONE = "event_boss";
const RULES_VERSION = 2;

// ── 潮汐（純時間函式）──
const TIDE_EPOCH = Date.parse("2026-01-01T00:00:00+08:00");
const RISE_MS = 10 * 60 * 1000;
const EBB_MS = 5 * 60 * 1000;
const CYCLE_MS = RISE_MS + EBB_MS;
const RISE_OTHER_MULT = 0.7;
const EBB_MULT = 1.5;

// ── 海嘯詠唱 ──
const PERIODIC_CAST_INTERVAL_MS = 3 * 60 * 1000;
// 舊名稱保留給既有 UI／呼叫端；現在等同週期檢查間隔。
const CAST_INTERVAL_MS = PERIODIC_CAST_INTERVAL_MS;
const CAST_MS = 3 * 60 * 1000;
const TSUNAMI_MS = 3 * 60 * 1000;
const BREACH_MS = 30 * 1000;
const BREACH_MULT = 1.3;
const CAST_DAMAGE_MULT = 0.01;
const CAST_GAUGE_MULT = 2;
const FIXED_CAST_HP_PCTS = Object.freeze([70, 30]);
const CAST_UNLOCK_HP_PCT = 70; // 舊匯出相容；不再代表週期海嘯的解鎖條件。
const ENCOUNTER_STALE_MS = 2 * 60 * 60 * 1000;

function parseMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function clampHpPct(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function resetEncounter(turtle, now) {
  for (const key of Object.keys(turtle)) delete turtle[key];
  turtle.rulesVersion = RULES_VERSION;
  turtle.encounterStartedAt = iso(now);
  turtle.nextPeriodicAt = iso(now + PERIODIC_CAST_INTERVAL_MS);
  turtle.castingUntil = null;
  turtle.castPausedUntil = null;
  turtle.tsunamiUntil = null;
  turtle.breachUntil = null;
  turtle.pendingForcedCasts = [];
  turtle.forced70Triggered = false;
  turtle.forced30Triggered = false;
  turtle.lastInterruptBy = null;
  turtle.lastBreachReason = null;
  turtle.lastCastReason = null;
}

function ensureEncounter(turtle, totalHpPct, now) {
  const startedAt = parseMs(turtle.encounterStartedAt);
  const lastHpPct = Number(turtle.lastHpPct);
  const returnedToFullHp = totalHpPct >= 99.999 && Number.isFinite(lastHpPct) && lastHpPct < 99.999;
  const stale = startedAt > 0 && now - startedAt >= ENCOUNTER_STALE_MS;
  if (turtle.rulesVersion !== RULES_VERSION || !startedAt || returnedToFullHp || stale) {
    resetEncounter(turtle, now);
  }
}

/** 現在的潮汐：{ phase:'rise'|'ebb', remainMs, riseMs, ebbMs } */
function tideAt(now = Date.now()) {
  const t = ((now - TIDE_EPOCH) % CYCLE_MS + CYCLE_MS) % CYCLE_MS;
  if (t < RISE_MS) return { phase: "rise", remainMs: RISE_MS - t, riseMs: RISE_MS, ebbMs: EBB_MS };
  return { phase: "ebb", remainMs: CYCLE_MS - t, riseMs: RISE_MS, ebbMs: EBB_MS };
}

/**
 * 推進已存在的詠唱／海嘯／破綻。occupiedThrough 是這一輪特殊狀態原本占用到的時間，
 * 用來略過期間內落下的週期檢查點，避免伺服器一段時間沒請求後補發重疊海嘯。
 */
function advanceActiveState(turtle, now, events) {
  let occupiedThrough = 0;
  const castUntil = parseMs(turtle.castingUntil);
  const tsunamiUntilBefore = parseMs(turtle.tsunamiUntil);
  const breachUntilBefore = parseMs(turtle.breachUntil);
  if (castUntil > 0) occupiedThrough = castUntil + TSUNAMI_MS + BREACH_MS;
  else if (tsunamiUntilBefore > 0) occupiedThrough = tsunamiUntilBefore + BREACH_MS;
  else if (breachUntilBefore > 0) occupiedThrough = breachUntilBefore;

  if (castUntil > 0 && now >= castUntil) {
    turtle.castingUntil = null;
    turtle.castPausedUntil = null;
    const tsunamiUntil = castUntil + TSUNAMI_MS;
    if (now < tsunamiUntil) {
      turtle.tsunamiUntil = iso(tsunamiUntil);
      events.push({ type: "tsunami" });
    } else {
      turtle.tsunamiUntil = null;
      const breachUntil = tsunamiUntil + BREACH_MS;
      if (now < breachUntil) {
        turtle.breachUntil = iso(breachUntil);
        turtle.lastBreachReason = "tsunami_end";
        events.push({ type: "breachStart", reason: "tsunami_end" });
      }
    }
  }

  const tsunamiUntil = parseMs(turtle.tsunamiUntil);
  if (tsunamiUntil > 0 && now >= tsunamiUntil) {
    turtle.tsunamiUntil = null;
    const breachUntil = tsunamiUntil + BREACH_MS;
    if (now < breachUntil) {
      turtle.breachUntil = iso(breachUntil);
      turtle.lastBreachReason = "tsunami_end";
      events.push({ type: "breachStart", reason: "tsunami_end" });
    }
  }

  const breachUntil = parseMs(turtle.breachUntil);
  if (breachUntil > 0 && now >= breachUntil) turtle.breachUntil = null;
  return occupiedThrough;
}

function isBusy(turtle, now) {
  return parseMs(turtle.castingUntil) > now || parseMs(turtle.tsunamiUntil) > now || parseMs(turtle.breachUntil) > now;
}

function startCast(turtle, reason, now, events) {
  turtle.castingUntil = iso(now + CAST_MS);
  turtle.castPausedUntil = null;
  turtle.tsunamiUntil = null;
  turtle.breachUntil = null;
  turtle.lastInterruptBy = null;
  turtle.lastBreachReason = null;
  turtle.lastCastReason = reason;
  events.push({ type: "castStart", reason });
}

/** 確保並推進海嘯狀態機（就地修改 state.turtle），回傳本次狀態事件。 */
function ensureCast(state, totalHpPct, now = Date.now()) {
  if (!state) return [];
  const turtle = state.turtle && typeof state.turtle === "object" ? state.turtle : {};
  state.turtle = turtle;
  const hpPct = clampHpPct(totalHpPct);
  const events = [];

  ensureEncounter(turtle, hpPct, now);
  const occupiedThrough = advanceActiveState(turtle, now, events);

  const pending = Array.isArray(turtle.pendingForcedCasts) ? turtle.pendingForcedCasts : [];
  turtle.pendingForcedCasts = pending;
  for (const threshold of FIXED_CAST_HP_PCTS) {
    const flag = `forced${threshold}Triggered`;
    if (hpPct <= threshold && !turtle[flag]) {
      turtle[flag] = true;
      if (!pending.includes(threshold)) pending.push(threshold);
      events.push({ type: "fixedCastQueued", threshold });
    }
  }

  let nextPeriodicAt = parseMs(turtle.nextPeriodicAt);
  if (!nextPeriodicAt) nextPeriodicAt = parseMs(turtle.encounterStartedAt) + PERIODIC_CAST_INTERVAL_MS;

  // 先跳過落在既有特殊狀態中的檢查點，再判斷目前是否有一個可發動的週期檢查點。
  if (occupiedThrough > 0 && nextPeriodicAt <= Math.min(now, occupiedThrough)) {
    nextPeriodicAt += (Math.floor((Math.min(now, occupiedThrough) - nextPeriodicAt) / PERIODIC_CAST_INTERVAL_MS) + 1) * PERIODIC_CAST_INTERVAL_MS;
  }
  const periodicDue = nextPeriodicAt <= now;
  if (periodicDue) {
    nextPeriodicAt += (Math.floor((now - nextPeriodicAt) / PERIODIC_CAST_INTERVAL_MS) + 1) * PERIODIC_CAST_INTERVAL_MS;
  }
  turtle.nextPeriodicAt = iso(nextPeriodicAt);

  if (!isBusy(turtle, now)) {
    if (pending.length > 0) {
      const threshold = pending.shift();
      startCast(turtle, `fixed_${threshold}`, now, events);
    } else if (periodicDue) {
      startCast(turtle, "periodic", now, events);
    }
  }

  turtle.lastHpPct = hpPct;
  return events;
}

/** 打斷詠唱（巨神震擊／區域冰封觸發時呼叫）。 */
function interrupt(state, byLabel, now = Date.now()) {
  const turtle = state?.turtle;
  if (!turtle || parseMs(turtle.castingUntil) <= now) return false;
  turtle.castingUntil = null;
  turtle.castPausedUntil = null;
  turtle.tsunamiUntil = null;
  turtle.breachUntil = iso(now + BREACH_MS);
  turtle.lastInterruptBy = String(byLabel || "");
  turtle.lastBreachReason = "interrupt";
  return true;
}

/**
 * 巨神震擊重置海嘯詠唱：暈眩期間不詠唱，暈眩結束後從 0 重跑完整詠唱條。
 * 這不是「打斷」，因此不會開啟破綻期。
 */
function resetCastAfterStun(state, byLabel, stunnedUntil, now = Date.now()) {
  const turtle = state?.turtle;
  const castUntil = parseMs(turtle?.castingUntil);
  if (!turtle || castUntil <= now) return false;

  const resumeAt = Math.max(now, parseMs(stunnedUntil));
  turtle.castPausedUntil = iso(resumeAt);
  turtle.castingUntil = iso(resumeAt + CAST_MS);
  turtle.tsunamiUntil = null;
  turtle.breachUntil = null;
  turtle.lastInterruptBy = String(byLabel || "");
  turtle.lastBreachReason = null;
  return true;
}

/**
 * 把「詠唱還剩多久」換算成這場戰鬥時間軸會被海嘯命中的回合。
 * 回合 1 發生在 t=0；若海嘯在第一、二回合之間完成，會在回合 2 開頭命中。
 * 沒在詠唱則回傳 null；回傳值大於本場最大回合代表本場結束後才會發動。
 */
function tsunamiRoundForBattle(state, roundMs, now = Date.now()) {
  const castingUntil = parseMs(state?.turtle?.castingUntil);
  if (castingUntil <= now) return null;
  const tickMs = Math.max(1, Math.floor(Number(roundMs) || 1));
  const remainMs = castingUntil - now;
  return Math.max(1, Math.ceil(remainMs / tickMs) + 1);
}

/** 這一場的戰鬥修正。 */
function battleMods(state, part, now = Date.now()) {
  const turtle = state?.turtle || {};
  if (parseMs(turtle.tsunamiUntil) > now) {
    return { headBlocked: false, mult: 1, forceHitHead: false, tsunami: true, casting: false, gaugeMult: 1 };
  }
  if (parseMs(turtle.breachUntil) > now) {
    return { headBlocked: false, mult: BREACH_MULT, forceHitHead: false, tsunami: false, casting: false, gaugeMult: 1 };
  }
  const tide = tideAt(now);
  const casting = parseMs(turtle.castingUntil) > now && parseMs(turtle.castPausedUntil) <= now;
  if (casting) {
    return {
      // 詠唱時整隻龜王進入同一層防護：所有部位都能打，但一律只承受 1% 傷害。
      // 這段覆蓋漲潮的龜首封鎖，讓任何目標都能用來累積冰凍／暈眩破解詠唱。
      headBlocked: false,
      mult: CAST_DAMAGE_MULT,
      forceHitHead: false,
      tsunami: false,
      casting: true,
      gaugeMult: CAST_GAUGE_MULT,
    };
  }
  if (tide.phase === "ebb") {
    return { headBlocked: false, mult: EBB_MULT, forceHitHead: part === "head", tsunami: false, casting: false, gaugeMult: 1 };
  }
  return { headBlocked: part === "head", mult: part === "head" ? 1 : RISE_OTHER_MULT, forceHitHead: false, tsunami: false, casting: false, gaugeMult: 1 };
}

/** 給前端／面板的顯示物件。 */
function view(state, totalHpPct, now = Date.now()) {
  const turtle = state?.turtle || {};
  const tide = tideAt(now);
  const castPausedUntil = parseMs(turtle.castPausedUntil);
  const castingUntil = parseMs(turtle.castingUntil);
  const castPaused = castPausedUntil > now && castingUntil > castPausedUntil;
  const casting = !castPaused && castingUntil > now;
  return {
    tide: { phase: tide.phase, remainMs: tide.remainMs, riseMs: RISE_MS, ebbMs: EBB_MS },
    casting,
    castPaused,
    castResumeInMs: castPaused ? castPausedUntil - now : 0,
    castRemainMs: casting ? Math.max(0, castingUntil - now) : 0,
    castMs: CAST_MS,
    castDamageMult: CAST_DAMAGE_MULT,
    castGaugeMult: CAST_GAUGE_MULT,
    tsunami: parseMs(turtle.tsunamiUntil) > now,
    tsunamiRemainMs: Math.max(0, parseMs(turtle.tsunamiUntil) - now),
    tsunamiMs: TSUNAMI_MS,
    breach: parseMs(turtle.breachUntil) > now,
    breachRemainMs: Math.max(0, parseMs(turtle.breachUntil) - now),
    breachReason: turtle.lastBreachReason || null,
    castUnlocked: true,
    nextCastInMs: Math.max(0, parseMs(turtle.nextPeriodicAt) - now),
    lastInterruptBy: turtle.lastInterruptBy || null,
    lastCastReason: turtle.lastCastReason || null,
    pendingForcedCasts: Array.isArray(turtle.pendingForcedCasts) ? [...turtle.pendingForcedCasts] : [],
    fixedCastHpPcts: [...FIXED_CAST_HP_PCTS],
    totalHpPct: clampHpPct(totalHpPct),
  };
}

module.exports = {
  ZONE,
  RULES_VERSION,
  RISE_MS, EBB_MS, CYCLE_MS, RISE_OTHER_MULT, EBB_MULT,
  CAST_UNLOCK_HP_PCT, CAST_INTERVAL_MS, PERIODIC_CAST_INTERVAL_MS,
  CAST_MS, TSUNAMI_MS, BREACH_MS, BREACH_MULT, CAST_DAMAGE_MULT, CAST_GAUGE_MULT,
  FIXED_CAST_HP_PCTS,
  tideAt, ensureCast, interrupt, resetCastAfterStun, tsunamiRoundForBattle, battleMods, view,
};
