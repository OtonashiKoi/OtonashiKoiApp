"use strict";

function createWorldBossEventRepository(collection, maintenance) {
  const writable = () => {
    if (maintenance.isStrict()) throw Object.assign(new Error("SEASON_RESET_WRITE_LOCKED"), { code: "SEASON_RESET_WRITE_LOCKED" });
  };
  return {
    async get(bossKey) {
      const row = await (await collection("worldBossEventState")).findOne({ _id: String(bossKey) });
      return row?.value || null;
    },
    async save(state, bossKey) {
      writable();
      await (await collection("worldBossEventState")).updateOne(
        { _id: String(bossKey) },
        { $set: { value: state, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      return state;
    },
    async finalizeQuiz({ bossKey, previous, next, now = Date.now() }) {
      writable();
      const result = await (await collection("worldBossEventState")).updateOne(
        {
          _id: String(bossKey),
          "value.runKey": previous.runKey,
          "value.quiz.id": previous.quiz.id,
          "value.quiz.status": "active",
          "value.quiz.endsAt": { $lte: Number(now) },
          "value.quiz.answers": previous.quiz.answers,
        },
        { $set: {
          "value.quiz": next.quiz,
          "value.effect": next.effect,
          "value.resolvedMarks": next.resolvedMarks,
          updatedAt: new Date().toISOString(),
        } }
      );
      return Boolean(result.matchedCount);
    },
    async submitAnswer({ bossKey, quizId, discordId, answer, now = Date.now() }) {
      writable();
      const field = `value.quiz.answers.${String(discordId)}`;
      const result = await (await collection("worldBossEventState")).updateOne(
        {
          _id: String(bossKey),
          "value.quiz.id": String(quizId),
          "value.quiz.status": "active",
          "value.quiz.endsAt": { $gt: Number(now) },
          $or: [{ "value.quiz.answerStartsAt": { $exists: false } }, { "value.quiz.answerStartsAt": { $lte: Number(now) } }],
          [field]: { $exists: false },
        },
        { $set: { [field]: answer, updatedAt: new Date().toISOString() } }
      );
      if (!result.matchedCount) {
        throw Object.assign(new Error("答題已結束，或你已經完成作答。"), { code: "HUTAO_QUIZ_CLOSED" });
      }
      return true;
    },
  };
}

module.exports = { createWorldBossEventRepository };
