"use strict";

const ZONE = "event_boss_hutao_preview";
const BOSS_KEY = "northwind_hutao";
const BOSS_ID = "event-northwind-hutao";
const PREVIEW_PLAYER_IDS = Object.freeze(["865264891991425055"]);

const WIND_PERIOD_MS = 60 * 1000;
const RIICHI_DURATION_MS = 60 * 1000;
const RIICHI_MARKS = Object.freeze([70, 40]);

const WINDS = Object.freeze([
  Object.freeze({
    key: "east", glyph: "🀀", name: "東場", color: "#6ee7b7",
    description: "胡桃身法全開，迴避率大幅上升。",
    bossDodgeBonus: 35,
  }),
  Object.freeze({
    key: "south", glyph: "🀁", name: "南場", color: "#ff7d8f",
    description: "胡桃攻擊傷害提高 25%。",
    bossDamageMultiplier: 1.25,
  }),
  Object.freeze({
    key: "west", glyph: "🀂", name: "西場", color: "#a78bfa",
    description: "全場玩家爆擊傷害降低 25%。",
    playerCritDamageMultiplier: 0.75,
  }),
  Object.freeze({
    key: "north", glyph: "🀃", name: "北場", color: "#7ce0ff",
    description: "胡桃迴避歸零；玩家傷害提高 35%，但胡桃攻擊提高 50%。",
    bossDodgeZero: true,
    bossDamageMultiplier: 1.5,
    playerFinalDamageMultiplier: 1.35,
  }),
]);

// 每題都是「四組完成面子＋一張單騎」，避免多重解或牌理爭議。
const QUESTIONS = Object.freeze([
  Object.freeze({
    id: "east_single_wait",
    prompt: "這副聽牌，胡哪一張？",
    hand: Object.freeze(["🀇", "🀈", "🀉", "🀊", "🀋", "🀌", "🀙", "🀚", "🀛", "🀕", "🀖", "🀗", "🀀"]),
    choices: Object.freeze([
      Object.freeze({ id: "east", glyph: "🀀", label: "東風" }),
      Object.freeze({ id: "south", glyph: "🀁", label: "南風" }),
      Object.freeze({ id: "west", glyph: "🀂", label: "西風" }),
      Object.freeze({ id: "north", glyph: "🀃", label: "北風" }),
    ]),
    correctChoiceId: "east",
  }),
  Object.freeze({
    id: "white_single_wait",
    prompt: "這副聽牌，胡哪一張？",
    hand: Object.freeze(["🀍", "🀎", "🀏", "🀑", "🀒", "🀓", "🀜", "🀝", "🀞", "🀅", "🀅", "🀅", "🀆"]),
    choices: Object.freeze([
      Object.freeze({ id: "white", glyph: "🀆", label: "白板" }),
      Object.freeze({ id: "red", glyph: "🀄", label: "紅中" }),
      Object.freeze({ id: "green", glyph: "🀅", label: "發財" }),
      Object.freeze({ id: "north", glyph: "🀃", label: "北風" }),
    ]),
    correctChoiceId: "white",
  }),
]);

function windAt(now = Date.now()) {
  const ms = Math.max(0, Number(now) || Date.now());
  const slot = Math.floor(ms / WIND_PERIOD_MS);
  const wind = WINDS[slot % WINDS.length];
  const remainingMs = WIND_PERIOD_MS - (ms % WIND_PERIOD_MS);
  return { ...wind, remainingMs, periodMs: WIND_PERIOD_MS, serverNow: ms };
}

function questionForMark(mark) {
  const idx = RIICHI_MARKS.indexOf(Number(mark));
  return QUESTIONS[idx >= 0 ? idx % QUESTIONS.length : 0];
}

function publicQuestion(question, revealAnswer = false) {
  if (!question) return null;
  return {
    id: question.id,
    prompt: question.prompt,
    hand: [...question.hand],
    choices: question.choices.map((choice) => ({ ...choice })),
    ...(revealAnswer ? { correctChoiceId: question.correctChoiceId } : {}),
  };
}

function resolveAnswerOutcome(answers, correctChoiceId) {
  const rows = Object.values(answers || {});
  const correct = rows.filter((answer) => answer?.choiceId === correctChoiceId).length;
  const wrong = rows.length - correct;
  const outcome = correct > wrong ? "deal_in" : wrong > correct ? "tsumo" : "draw";
  return { outcome, correct, wrong, total: rows.length };
}

function outcomeEffect(outcome) {
  if (outcome === "deal_in") {
    return {
      kind: "buff",
      name: "胡桃放銃",
      description: "玩家最終傷害 +20%、命中 +10，持續到下一次立直結算。",
      playerFinalDamageMultiplier: 1.2,
      playerHitBonus: 10,
    };
  }
  if (outcome === "tsumo") {
    return {
      kind: "debuff",
      name: "胡桃自摸",
      description: "玩家最終傷害 -15%、命中 -10，持續到下一次立直結算。",
      playerFinalDamageMultiplier: 0.85,
      playerHitBonus: -10,
    };
  }
  return {
    kind: "none",
    name: "流局",
    description: "雙方票數相同，沒有額外效果。",
    playerFinalDamageMultiplier: 1,
    playerHitBonus: 0,
  };
}

function crossedRiichiMark(previousHp, nextHp, maxHp, resolvedMarks = []) {
  const max = Math.max(1, Number(maxHp) || 1);
  const prevPct = Math.max(0, (Number(previousHp) || 0) / max * 100);
  const nextPct = Math.max(0, (Number(nextHp) || 0) / max * 100);
  const resolved = new Set((resolvedMarks || []).map(Number));
  return RIICHI_MARKS.find((mark) => !resolved.has(mark) && prevPct > mark && nextPct <= mark) || null;
}

function hpAtMark(maxHp, mark) {
  return Math.max(1, Math.round(Math.max(1, Number(maxHp) || 1) * Number(mark) / 100));
}

module.exports = {
  ZONE,
  BOSS_KEY,
  BOSS_ID,
  PREVIEW_PLAYER_IDS,
  WIND_PERIOD_MS,
  RIICHI_DURATION_MS,
  RIICHI_MARKS,
  WINDS,
  QUESTIONS,
  windAt,
  questionForMark,
  publicQuestion,
  resolveAnswerOutcome,
  outcomeEffect,
  crossedRiichiMark,
  hpAtMark,
};
