"use strict";

const assert = require("node:assert/strict");
const { HutaoEventService } = require("../src/services/worldBoss/hutaoEventService");
const {
  QUESTIONS,
  RIICHI_DURATION_MS,
  crossedRiichiMark,
  hpAtMark,
  questionForMark,
  windAt,
} = require("../src/shared/hutaoEvent");

const TILE_GLYPHS = [
  "🀇", "🀈", "🀉", "🀊", "🀋", "🀌", "🀍", "🀎", "🀏",
  "🀐", "🀑", "🀒", "🀓", "🀔", "🀕", "🀖", "🀗", "🀘",
  "🀙", "🀚", "🀛", "🀜", "🀝", "🀞", "🀟", "🀠", "🀡",
  "🀀", "🀁", "🀂", "🀃", "🀄", "🀅", "🀆",
];
const TILE_INDEX = new Map(TILE_GLYPHS.map((glyph, index) => [glyph, index]));

function canFormMelds(counts) {
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return true;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canFormMelds(counts)) {
      counts[first] += 3;
      return true;
    }
    counts[first] += 3;
  }
  const rank = first % 9;
  if (first < 27 && rank <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first] -= 1;
    counts[first + 1] -= 1;
    counts[first + 2] -= 1;
    if (canFormMelds(counts)) {
      counts[first] += 1;
      counts[first + 1] += 1;
      counts[first + 2] += 1;
      return true;
    }
    counts[first] += 1;
    counts[first + 1] += 1;
    counts[first + 2] += 1;
  }
  return false;
}

function isStandardWin(counts) {
  for (let pair = 0; pair < counts.length; pair += 1) {
    if (counts[pair] < 2) continue;
    const rest = [...counts];
    rest[pair] -= 2;
    if (canFormMelds(rest)) return true;
  }
  return false;
}

function actualWaitGlyphs(hand) {
  const counts = Array(TILE_GLYPHS.length).fill(0);
  for (const glyph of hand) {
    assert.equal(TILE_INDEX.has(glyph), true, `未知麻將牌 ${glyph}`);
    counts[TILE_INDEX.get(glyph)] += 1;
  }
  const waits = [];
  for (let tile = 0; tile < counts.length; tile += 1) {
    if (counts[tile] >= 4) continue;
    counts[tile] += 1;
    if (isStandardWin(counts)) waits.push(TILE_GLYPHS[tile]);
    counts[tile] -= 1;
  }
  return waits;
}

class MemoryRepository {
  constructor() { this.state = null; }
  async get() { return this.state ? structuredClone(this.state) : null; }
  async save(state) { this.state = structuredClone(state); return state; }
  async submitAnswer({ quizId, discordId, answer, now }) {
    if (this.state?.quiz?.id !== quizId || this.state.quiz.status !== "active" || this.state.quiz.endsAt <= now) {
      throw Object.assign(new Error("closed"), { code: "HUTAO_QUIZ_CLOSED" });
    }
    if (this.state.quiz.answers[discordId]) {
      throw Object.assign(new Error("answered"), { code: "HUTAO_QUIZ_CLOSED" });
    }
    this.state.quiz.answers[discordId] = structuredClone(answer);
  }
}

async function main() {
  assert.deepEqual([0, 1, 2, 3].map((slot) => windAt(slot * 60_000).key), ["east", "south", "west", "north"]);
  assert.equal(crossedRiichiMark(12_000_000, 8_000_000, 12_000_000, []), 70);
  assert.equal(hpAtMark(12_000_000, 70), 8_400_000);
  assert.equal(crossedRiichiMark(8_400_000, 4_000_000, 12_000_000, [70]), 40);
  assert.equal(RIICHI_DURATION_MS, 30_000, "立直答題時間必須是 30 秒");
  assert.equal(QUESTIONS.filter((question) => question.waitType === "ryanmen").length, 6);
  assert.equal(QUESTIONS.filter((question) => question.waitType === "kanchan").length, 6);

  for (const question of QUESTIONS) {
    assert.equal(question.hand.length, 13, `${question.id} 必須是 13 張聽牌`);
    assert.equal(new Set(question.hand).size > 0, true);
    assert.equal(question.correctChoiceIds.every((id) => question.choices.some((choice) => choice.id === id)), true);
    const declared = question.correctChoiceIds
      .map((id) => question.choices.find((choice) => choice.id === id).glyph)
      .sort();
    const actual = actualWaitGlyphs(question.hand).sort();
    assert.deepEqual(declared, actual, `${question.id} 宣告正解與實際聽牌不一致`);
    assert.equal(actual.length, question.waitType === "ryanmen" ? 2 : 1, `${question.id} 等待型不正確`);
  }
  assert.equal(new Set(Array.from({ length: 24 }, (_, i) => questionForMark(70, `run-${i}`).id)).size, 6);
  assert.equal(new Set(Array.from({ length: 24 }, (_, i) => questionForMark(40, `run-${i}`).id)).size, 6);

  const repo = new MemoryRepository();
  const service = new HutaoEventService(repo);
  const startAt = 1_000_000;
  await service.resetRun("test-run");
  const active = await service.startQuiz(70, "test-run", startAt);
  assert.equal(active.blocking, true);
  assert.equal(active.quiz.question.correctChoiceIds, undefined, "結算前不可洩漏正解");
  assert.equal(active.quiz.question.id, questionForMark(70, "test-run").id, "同一 runKey 必須穩定選到同一題");
  const firstQuestion = questionForMark(70, "test-run");
  const firstCorrect = firstQuestion.correctChoiceIds[0];
  const firstWrong = firstQuestion.choices.find((choice) => !firstQuestion.correctChoiceIds.includes(choice.id)).id;

  const afterCorrect = await service.submitAnswer({
    quizId: active.quiz.id,
    discordId: "1",
    displayName: "音無恋",
    choiceId: firstCorrect,
  }, startAt + 1_000);
  assert.equal(afterCorrect.quiz.answers[0].choiceId, firstCorrect, "等待期間必須公開玩家選擇");
  assert.equal(afterCorrect.quiz.answers[0].correct, undefined, "等待期間不可公開答對與否");
  await assert.rejects(() => service.submitAnswer({
    quizId: active.quiz.id,
    discordId: "1",
    displayName: "音無恋",
    choiceId: firstWrong,
  }, startAt + 1_500), { code: "HUTAO_QUIZ_CLOSED" });

  await service.submitAnswer({
    quizId: active.quiz.id,
    discordId: "2",
    displayName: "測試玩家",
    choiceId: firstWrong,
  }, startAt + 2_000);
  const resolved = await service.getSnapshot(startAt + RIICHI_DURATION_MS + 1);
  assert.equal(resolved.blocking, false);
  assert.equal(resolved.quiz.result.outcome, "draw");
  assert.deepEqual(resolved.quiz.question.correctChoiceIds, firstQuestion.correctChoiceIds);
  assert.deepEqual(resolved.resolvedMarks, [70]);
  assert.equal(resolved.effect.kind, "none");

  const second = await service.startQuiz(40, "test-run", startAt + RIICHI_DURATION_MS + 2);
  const secondQuestion = questionForMark(40, "test-run");
  await service.submitAnswer({
    quizId: second.quiz.id,
    discordId: "1",
    displayName: "音無恋",
    choiceId: secondQuestion.correctChoiceIds[0],
  }, startAt + RIICHI_DURATION_MS + 3);
  const win = await service.getSnapshot(startAt + RIICHI_DURATION_MS * 2 + 3);
  assert.equal(win.quiz.result.outcome, "deal_in");
  assert.equal(win.effect.playerFinalDamageMultiplier, 1.2);
  assert.equal(win.effect.playerHitBonus, 10);

  console.log("胡桃場風、12 題兩面／坎張題庫、70/40 門檻、30 秒立直、答案鎖定與結算效果驗證通過。");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
