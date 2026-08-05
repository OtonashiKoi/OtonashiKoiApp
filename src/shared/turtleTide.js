"use strict";
/**
 * 島島龜王（活動世界王）——潮汐＋海嘯詠唱，純函式＋區域狀態機。
 *
 * 設計（使用者定案 2026-07-29）：
 *   【潮汐】時間驅動、全服同步（不是打出來的，是海的節奏）：
 *     - 週期 15 分鐘＝漲潮 10 分（龜首縮殼打不到、其他部位受傷 ×0.7）
 *                 ＋退潮 5 分（全部位受傷 ×1.5、打龜首必中）
 *     - 由固定紀元推算，無需存狀態、三入口天然同步
 *   【海嘯詠唱】總血 ≤70%（甦醒期）後解鎖：
 *     - 每 8 分鐘在「漲潮期」發動詠唱 90 秒（全區紫紅詠唱條）
 *     - 詠唱完成 → 海嘯 60 秒：期間出戰的人「開場即死」（真即死：無視結界/聖域/免死）
 *     - 打斷唯二：巨神震擊（矮人暈眩條觸發）／區域冰封（元素師冰凍值觸發）
 *     - 打斷成功 → 破綻 30 秒：全部位受傷 ×1.3、龜首可打（蓋過漲潮懲罰）
 *     - 打斷/施放後計時重算（下一次詠唱＝now + 8 分鐘）
 *   狀態存放：區域 battleState.turtle = { nextCastAt, castingUntil, tsunamiUntil, breachUntil, lastInterruptBy }
 *   （與 hellfang* 欄位同一份 zone monsterState，呼叫端讀改存）
 */

const ZONE = "event_boss";

// ── 潮汐（純時間函式）──
const TIDE_EPOCH = Date.parse("2026-01-01T00:00:00+08:00");
const RISE_MS = 10 * 60 * 1000;   // 漲潮
const EBB_MS = 5 * 60 * 1000;     // 退潮
const CYCLE_MS = RISE_MS + EBB_MS;

const RISE_OTHER_MULT = 0.7;      // 漲潮：非龜首部位受傷 ×0.7
const EBB_MULT = 1.5;             // 退潮：全部位 ×1.5

// ── 海嘯詠唱 ──
const CAST_UNLOCK_HP_PCT = 70;    // 總血 ≤70% 解鎖
const CAST_INTERVAL_MS = 8 * 60 * 1000;
const CAST_MS = 90 * 1000;
const TSUNAMI_MS = 60 * 1000;
const BREACH_MS = 30 * 1000;
const BREACH_MULT = 1.3;

/** 現在的潮汐：{ phase:'rise'|'ebb', remainMs, riseMs, ebbMs } */
function tideAt(now = Date.now()) {
  const t = ((now - TIDE_EPOCH) % CYCLE_MS + CYCLE_MS) % CYCLE_MS;
  if (t < RISE_MS) return { phase: "rise", remainMs: RISE_MS - t, riseMs: RISE_MS, ebbMs: EBB_MS };
  return { phase: "ebb", remainMs: CYCLE_MS - t, riseMs: RISE_MS, ebbMs: EBB_MS };
}

/** 確保並推進詠唱狀態機（就地修改 state.turtle）。回傳事件列（可能為空）。 */
function ensureCast(state, totalHpPct, now = Date.now()) {
  if (!state) return [];
  const t = (state.turtle && typeof state.turtle === "object") ? state.turtle : {};
  state.turtle = t;
  const events = [];
  const num = (v) => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : 0; };

  // 詠唱到期 → 海嘯降臨
  if (num(t.castingUntil) > 0 && now >= num(t.castingUntil)) {
    t.tsunamiUntil = new Date(num(t.castingUntil) + TSUNAMI_MS).toISOString();
    t.castingUntil = null;
    t.nextCastAt = new Date(now + CAST_INTERVAL_MS).toISOString();
    events.push({ type: "tsunami" });
  }
  // 過期清理
  if (num(t.tsunamiUntil) > 0 && now >= num(t.tsunamiUntil)) t.tsunamiUntil = null;
  if (num(t.breachUntil) > 0 && now >= num(t.breachUntil)) t.breachUntil = null;

  // 開始詠唱：甦醒期＋漲潮＋計時到＋沒在詠唱/海嘯中
  if (!t.castingUntil && !t.tsunamiUntil && Number(totalHpPct) <= CAST_UNLOCK_HP_PCT) {
    if (!t.nextCastAt) {
      t.nextCastAt = new Date(now + CAST_INTERVAL_MS).toISOString(); // 首次進入甦醒期起算
    } else if (now >= num(t.nextCastAt) && tideAt(now).phase === "rise") {
      t.castingUntil = new Date(now + CAST_MS).toISOString();
      events.push({ type: "castStart" });
    }
  }
  return events;
}

/** 打斷詠唱（巨神震擊/區域冰封觸發時呼叫）。詠唱中才有效，回傳是否成功。 */
function interrupt(state, byLabel, now = Date.now()) {
  const t = state?.turtle;
  if (!t) return false;
  const until = Date.parse(t.castingUntil || "");
  if (!Number.isFinite(until) || now >= until) return false;
  t.castingUntil = null;
  t.breachUntil = new Date(now + BREACH_MS).toISOString();
  t.nextCastAt = new Date(now + CAST_INTERVAL_MS).toISOString();
  t.lastInterruptBy = String(byLabel || "");
  return true;
}

/** 這一場的戰鬥修正：{ headBlocked, mult, forceHitHead, tsunami } */
function battleMods(state, part, now = Date.now()) {
  const t = state?.turtle || {};
  const num = (v) => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : 0; };
  if (num(t.tsunamiUntil) > now) {
    return { headBlocked: false, mult: 1, forceHitHead: false, tsunami: true };
  }
  if (num(t.breachUntil) > now) {
    // 破綻：蓋過漲潮懲罰——全部位可打 ×1.3
    return { headBlocked: false, mult: BREACH_MULT, forceHitHead: false, tsunami: false };
  }
  const tide = tideAt(now);
  if (tide.phase === "ebb") {
    return { headBlocked: false, mult: EBB_MULT, forceHitHead: part === "head", tsunami: false };
  }
  return { headBlocked: part === "head", mult: part === "head" ? 1 : RISE_OTHER_MULT, forceHitHead: false, tsunami: false };
}

/** 給前端／面板的顯示物件 */
function view(state, totalHpPct, now = Date.now()) {
  const t = state?.turtle || {};
  const num = (v) => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : 0; };
  const tide = tideAt(now);
  return {
    tide: { phase: tide.phase, remainMs: tide.remainMs, riseMs: RISE_MS, ebbMs: EBB_MS },
    casting: num(t.castingUntil) > now,
    castRemainMs: Math.max(0, num(t.castingUntil) - now),
    castMs: CAST_MS,
    tsunami: num(t.tsunamiUntil) > now,
    tsunamiRemainMs: Math.max(0, num(t.tsunamiUntil) - now),
    breach: num(t.breachUntil) > now,
    breachRemainMs: Math.max(0, num(t.breachUntil) - now),
    castUnlocked: Number(totalHpPct) <= CAST_UNLOCK_HP_PCT,
    nextCastInMs: num(t.nextCastAt) > now ? num(t.nextCastAt) - now : 0,
    lastInterruptBy: t.lastInterruptBy || null,
  };
}

module.exports = {
  ZONE,
  RISE_MS, EBB_MS, CYCLE_MS, RISE_OTHER_MULT, EBB_MULT,
  CAST_UNLOCK_HP_PCT, CAST_INTERVAL_MS, CAST_MS, TSUNAMI_MS, BREACH_MS, BREACH_MULT,
  tideAt, ensureCast, interrupt, battleMods, view,
};
