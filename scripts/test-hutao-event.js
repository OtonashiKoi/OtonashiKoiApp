"use strict";

const assert = require("node:assert/strict");
const { HutaoEventService } = require("../src/services/worldBoss/hutaoEventService");
const {
  QUESTIONS,
  RIICHI_DURATION_MS,
  crossedRiichiMark,
  hpAtMark,
  windAt,
} = require("../src/shared/hutaoEvent");

class MemoryRepository {
  constructor() { this.state = null; }
  async get() { return this.state ? structuredClone(this.state) : null; }
  async save(state) { this.state = structuredClone(state); return state; }
  async submitAnswer({ quizId, discordId, answer, now }) {
    if (this.state?.quiz?.id !== quizId || this.state.quiz.status !== "active" || this.state.quiz.endsAt <= now) {
      throw Object.assign(new Error("closed"), { code: "HUTAO_QUIZ_CLOSED" });
    }
    this.state.quiz.answers[discordId] = structuredClone(answer);
  }
}

async function main() {
  assert.deepEqual([0, 1, 2, 3].map((slot) => windAt(slot * 60_000).key), ["east", "south", "west", "north"]);
  assert.equal(crossedRiichiMark(12_000_000, 8_000_000, 12_000_000, []), 70);
  assert.equal(hpAtMark(12_000_000, 70), 8_400_000);
  assert.equal(crossedRiichiMark(8_400_000, 4_000_000, 12_000_000, [70]), 40);

  for (const question of QUESTIONS) {
    assert.equal(question.hand.length, 13, `${question.id} 必須是 13 張聽牌`);
    assert.equal(question.choices.some((choice) => choice.id === question.correctChoiceId), true);
  }

  const repo = new MemoryRepository();
  const service = new HutaoEventService(repo);
  const startAt = 1_000_000;
  await service.resetRun("test-run");
  const active = await service.startQuiz(70, "test-run", startAt);
  assert.equal(active.blocking, true);
  assert.equal(active.quiz.question.correctChoiceId, undefined, "結算前不可洩漏正解");

  const afterCorrect = await service.submitAnswer({
    quizId: active.quiz.id,
    discordId: "1",
    displayName: "音無恋",
    choiceId: "east",
  }, startAt + 1_000);
  assert.equal(afterCorrect.quiz.answers[0].choiceLabel, "東風", "等待期間必須公開玩家選擇");
  assert.equal(afterCorrect.quiz.answers[0].correct, undefined, "等待期間不可公開答對與否");

  await service.submitAnswer({
    quizId: active.quiz.id,
    discordId: "2",
    displayName: "測試玩家",
    choiceId: "south",
  }, startAt + 2_000);
  const resolved = await service.getSnapshot(startAt + RIICHI_DURATION_MS + 1);
  assert.equal(resolved.blocking, false);
  assert.equal(resolved.quiz.result.outcome, "draw");
  assert.equal(resolved.quiz.question.correctChoiceId, "east");
  assert.deepEqual(resolved.resolvedMarks, [70]);
  assert.equal(resolved.effect.kind, "none");

  const second = await service.startQuiz(40, "test-run", startAt + RIICHI_DURATION_MS + 2);
  await service.submitAnswer({
    quizId: second.quiz.id,
    discordId: "1",
    displayName: "音無恋",
    choiceId: "white",
  }, startAt + RIICHI_DURATION_MS + 3);
  const win = await service.getSnapshot(startAt + RIICHI_DURATION_MS * 2 + 3);
  assert.equal(win.quiz.result.outcome, "deal_in");
  assert.equal(win.effect.playerFinalDamageMultiplier, 1.2);
  assert.equal(win.effect.playerHitBonus, 10);

  console.log("胡桃場風、70/40 門檻、60 秒立直、即時答案與結算效果驗證通過。");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
