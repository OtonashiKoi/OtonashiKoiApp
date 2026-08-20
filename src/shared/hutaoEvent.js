"use strict";

const ZONE = "event_boss_hutao_preview";
const BOSS_KEY = "northwind_hutao";
const BOSS_ID = "event-northwind-hutao";
const PREVIEW_PLAYER_IDS = Object.freeze(["865264891991425055"]);

const WIND_PERIOD_MS = 60 * 1000;
const RIICHI_DURATION_MS = 30 * 1000;
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

const TILE = Object.freeze({
  m1: ["🀇", "一萬"], m2: ["🀈", "二萬"], m3: ["🀉", "三萬"],
  m4: ["🀊", "四萬"], m5: ["🀋", "五萬"], m6: ["🀌", "六萬"],
  m7: ["🀍", "七萬"], m8: ["🀎", "八萬"], m9: ["🀏", "九萬"],
  s1: ["🀐", "一索"], s2: ["🀑", "二索"], s3: ["🀒", "三索"],
  s4: ["🀓", "四索"], s5: ["🀔", "五索"], s6: ["🀕", "六索"],
  s7: ["🀖", "七索"], s8: ["🀗", "八索"], s9: ["🀘", "九索"],
  p1: ["🀙", "一筒"], p2: ["🀚", "二筒"], p3: ["🀛", "三筒"],
  p4: ["🀜", "四筒"], p5: ["🀝", "五筒"], p6: ["🀞", "六筒"],
  p7: ["🀟", "七筒"], p8: ["🀠", "八筒"], p9: ["🀡", "九筒"],
  east: ["🀀", "東風"], south: ["🀁", "南風"], west: ["🀂", "西風"], north: ["🀃", "北風"],
  red: ["🀄", "紅中"], green: ["🀅", "發財"], white: ["🀆", "白板"],
});

function choice(id) {
  const [glyph, label] = TILE[id];
  return Object.freeze({ id, glyph, label });
}

function question({ id, waitType, hand, choices, correctChoiceIds }) {
  return Object.freeze({
    id,
    waitType,
    prompt: "這副聽牌，胡哪一張？",
    hand: Object.freeze(hand.map((tileId) => TILE[tileId][0])),
    choices: Object.freeze(choices.map(choice)),
    correctChoiceIds: Object.freeze([...correctChoiceIds]),
  });
}

// 70% 固定抽兩面題、40% 固定抽坎張題；每一輪依 runKey 穩定選題，
// 讓多進程與斷線重連看到同一題，同時避免每場都背固定答案。
const RYANMEN_QUESTIONS = Object.freeze([
  question({
    id: "ryanmen_m34", waitType: "ryanmen",
    hand: ["m1", "m2", "m3", "p4", "p5", "p6", "s7", "s8", "s9", "east", "east", "m3", "m4"],
    choices: ["m2", "m5", "m6", "p3"], correctChoiceIds: ["m2", "m5"],
  }),
  question({
    id: "ryanmen_p67", waitType: "ryanmen",
    hand: ["m4", "m5", "m6", "p1", "p2", "p3", "s7", "s8", "s9", "white", "white", "p6", "p7"],
    choices: ["p5", "p8", "p4", "s6"], correctChoiceIds: ["p5", "p8"],
  }),
  question({
    id: "ryanmen_s45", waitType: "ryanmen",
    hand: ["m7", "m8", "m9", "p3", "p4", "p5", "s1", "s2", "s3", "red", "red", "s4", "s5"],
    choices: ["s3", "s6", "s2", "m6"], correctChoiceIds: ["s3", "s6"],
  }),
  question({
    id: "ryanmen_m78", waitType: "ryanmen",
    hand: ["m1", "m2", "m3", "p6", "p7", "p8", "s3", "s4", "s5", "green", "green", "m7", "m8"],
    choices: ["m6", "m9", "m5", "p9"], correctChoiceIds: ["m6", "m9"],
  }),
  question({
    id: "ryanmen_p23", waitType: "ryanmen",
    hand: ["m3", "m4", "m5", "p7", "p8", "p9", "s4", "s5", "s6", "north", "north", "p2", "p3"],
    choices: ["p1", "p4", "p5", "s3"], correctChoiceIds: ["p1", "p4"],
  }),
  question({
    id: "ryanmen_s56", waitType: "ryanmen",
    hand: ["m6", "m7", "m8", "p2", "p3", "p4", "s1", "s2", "s3", "south", "south", "s5", "s6"],
    choices: ["s4", "s7", "s8", "m5"], correctChoiceIds: ["s4", "s7"],
  }),
]);

const KANCHAN_QUESTIONS = Object.freeze([
  question({
    id: "kanchan_m24", waitType: "kanchan",
    hand: ["m7", "m8", "m9", "p1", "p2", "p3", "s7", "s8", "s9", "east", "east", "m2", "m4"],
    choices: ["m3", "m1", "m5", "p4"], correctChoiceIds: ["m3"],
  }),
  question({
    id: "kanchan_p68", waitType: "kanchan",
    hand: ["m1", "m2", "m3", "p1", "p2", "p3", "s7", "s8", "s9", "white", "white", "p6", "p8"],
    choices: ["p7", "p5", "p9", "s6"], correctChoiceIds: ["p7"],
  }),
  question({
    id: "kanchan_s35", waitType: "kanchan",
    hand: ["m7", "m8", "m9", "p1", "p2", "p3", "s7", "s8", "s9", "red", "red", "s3", "s5"],
    choices: ["s4", "s2", "s6", "m6"], correctChoiceIds: ["s4"],
  }),
  question({
    id: "kanchan_p46", waitType: "kanchan",
    hand: ["m1", "m2", "m3", "p7", "p8", "p9", "s1", "s2", "s3", "green", "green", "p4", "p6"],
    choices: ["p5", "p3", "p7", "s4"], correctChoiceIds: ["p5"],
  }),
  question({
    id: "kanchan_m57", waitType: "kanchan",
    hand: ["m1", "m2", "m3", "p7", "p8", "p9", "s1", "s2", "s3", "north", "north", "m5", "m7"],
    choices: ["m6", "m4", "m8", "p6"], correctChoiceIds: ["m6"],
  }),
  question({
    id: "kanchan_s46", waitType: "kanchan",
    hand: ["m1", "m2", "m3", "p7", "p8", "p9", "s1", "s2", "s3", "south", "south", "s4", "s6"],
    choices: ["s5", "s3", "s7", "m4"], correctChoiceIds: ["s5"],
  }),
]);

const QUESTIONS = Object.freeze([...RYANMEN_QUESTIONS, ...KANCHAN_QUESTIONS]);
const QUESTION_BY_ID = new Map(QUESTIONS.map((entry) => [entry.id, entry]));

function stableQuestionIndex(value, length) {
  let hash = 2166136261;
  for (const char of String(value || "hutao")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(1, length);
}

function windAt(now = Date.now()) {
  const parsedNow = Number(now);
  const ms = Math.max(0, Number.isFinite(parsedNow) ? parsedNow : Date.now());
  const slot = Math.floor(ms / WIND_PERIOD_MS);
  const wind = WINDS[slot % WINDS.length];
  const remainingMs = WIND_PERIOD_MS - (ms % WIND_PERIOD_MS);
  return { ...wind, remainingMs, periodMs: WIND_PERIOD_MS, serverNow: ms };
}

function questionForMark(mark, runKey = null) {
  const pool = Number(mark) === 40 ? KANCHAN_QUESTIONS : RYANMEN_QUESTIONS;
  return pool[stableQuestionIndex(`${String(runKey || "default")}:${Number(mark)}`, pool.length)];
}

function questionById(questionId, mark = 70, runKey = null) {
  return QUESTION_BY_ID.get(String(questionId || "")) || questionForMark(mark, runKey);
}

function publicQuestion(question, revealAnswer = false) {
  if (!question) return null;
  return {
    id: question.id,
    prompt: question.prompt,
    hand: [...question.hand],
    choices: question.choices.map((choice) => ({ ...choice })),
    ...(revealAnswer ? { correctChoiceIds: [...question.correctChoiceIds] } : {}),
  };
}

function resolveAnswerOutcome(answers, correctChoiceIds) {
  const accepted = new Set(Array.isArray(correctChoiceIds) ? correctChoiceIds : [correctChoiceIds]);
  const rows = Object.values(answers || {});
  const correct = rows.filter((answer) => accepted.has(answer?.choiceId)).length;
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
  questionById,
  publicQuestion,
  resolveAnswerOutcome,
  outcomeEffect,
  crossedRiichiMark,
  hpAtMark,
};
