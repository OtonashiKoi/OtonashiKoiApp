"use strict";

const {
  BOSS_KEY,
  RIICHI_DURATION_MS,
  windAt,
  questionForMark,
  questionById,
  publicQuestion,
  resolveAnswerOutcome,
  outcomeEffect,
} = require("../../shared/hutaoEvent");

function defaultState(runKey = null) {
  return {
    runKey: runKey || null,
    resolvedMarks: [],
    quiz: null,
    effect: null,
  };
}

class HutaoEventService {
  constructor(repository) {
    this.repo = repository;
  }

  async _read() {
    const value = await this.repo.get(BOSS_KEY);
    return { ...defaultState(), ...(value || {}) };
  }

  async resetRun(runKey) {
    const key = String(runKey || "").trim() || new Date().toISOString();
    const state = defaultState(key);
    await this.repo.save(state, BOSS_KEY);
    return this._snapshot(state);
  }

  async ensureRun(runKey) {
    const key = String(runKey || "").trim();
    const state = await this._read();
    if (key && state.runKey !== key) return this.resetRun(key);
    return this.getSnapshot();
  }

  async startQuiz(mark, runKey = null, now = Date.now()) {
    let state = await this._read();
    const key = String(runKey || "").trim();
    if (key && state.runKey !== key) state = defaultState(key);
    if ((state.resolvedMarks || []).map(Number).includes(Number(mark))) return this._snapshot(state, now);
    if (state.quiz?.status === "active" && Number(state.quiz.endsAt) > now) return this._snapshot(state, now);

    const question = questionForMark(mark, state.runKey);
    state.quiz = {
      id: `${state.runKey || "run"}:${Number(mark)}:${Math.floor(now)}`,
      mark: Number(mark),
      questionId: question.id,
      status: "active",
      startedAt: now,
      endsAt: now + RIICHI_DURATION_MS,
      answers: {},
      result: null,
    };
    await this.repo.save(state, BOSS_KEY);
    return this._snapshot(state, now);
  }

  async submitAnswer({ quizId, discordId, displayName, choiceId }, now = Date.now()) {
    await this._finalizeIfExpired(now);
    const state = await this._read();
    const quiz = state.quiz;
    if (!quiz || quiz.status !== "active" || quiz.id !== String(quizId || "")) {
      throw Object.assign(new Error("這題已經結算，請等待下一次立直。"), { code: "HUTAO_QUIZ_CLOSED" });
    }
    if (Number(quiz.endsAt) <= now) {
      await this._finalizeIfExpired(now);
      throw Object.assign(new Error("答題時間已結束。"), { code: "HUTAO_QUIZ_CLOSED" });
    }
    const question = questionById(quiz.questionId, quiz.mark, state.runKey);
    if (!question.choices.some((choice) => choice.id === choiceId)) {
      throw Object.assign(new Error("請選擇有效的麻將牌。"), { code: "HUTAO_INVALID_CHOICE" });
    }
    await this.repo.submitAnswer({
      bossKey: BOSS_KEY,
      quizId: quiz.id,
      discordId: String(discordId),
      answer: {
        displayName: String(displayName || "玩家"),
        choiceId,
        answeredAt: now,
      },
      now,
    });
    return this.getSnapshot(now);
  }

  async _finalizeIfExpired(now = Date.now()) {
    const state = await this._read();
    const quiz = state.quiz;
    if (!quiz || quiz.status !== "active" || Number(quiz.endsAt) > now) return state;
    const question = questionById(quiz.questionId, quiz.mark, state.runKey);
    const result = resolveAnswerOutcome(quiz.answers, question.correctChoiceIds);
    const effect = outcomeEffect(result.outcome);
    const next = {
      ...state,
      resolvedMarks: [...new Set([...(state.resolvedMarks || []).map(Number), Number(quiz.mark)])],
      effect,
      quiz: {
        ...quiz,
        status: "resolved",
        resolvedAt: now,
        result,
      },
    };
    await this.repo.save(next, BOSS_KEY);
    return next;
  }

  async getSnapshot(now = Date.now()) {
    const state = await this._finalizeIfExpired(now);
    return this._snapshot(state, now);
  }

  async getCombatModifiers(now = Date.now()) {
    const snapshot = await this.getSnapshot(now);
    return {
      wind: snapshot.wind,
      effect: snapshot.effect,
      blocked: snapshot.blocking,
      quiz: snapshot.quiz,
      resolvedMarks: snapshot.resolvedMarks,
      runKey: snapshot.runKey,
    };
  }

  _snapshot(state, now = Date.now()) {
    const quiz = state.quiz;
    const question = quiz ? questionById(quiz.questionId, quiz.mark, state.runKey) : null;
    const resolved = quiz?.status === "resolved";
    const choiceById = Object.fromEntries((question?.choices || []).map((choice) => [choice.id, choice]));
    const answers = Object.entries(quiz?.answers || {}).map(([discordId, answer]) => ({
      discordId,
      displayName: answer.displayName || "玩家",
      choiceId: answer.choiceId,
      choiceLabel: choiceById[answer.choiceId]?.label || answer.choiceId,
      choiceGlyph: choiceById[answer.choiceId]?.glyph || "🀫",
      answeredAt: Number(answer.answeredAt) || null,
      ...(resolved ? { correct: question.correctChoiceIds.includes(answer.choiceId) } : {}),
    }));
    return {
      key: "hutao_riichi",
      runKey: state.runKey || null,
      wind: windAt(now),
      blocking: quiz?.status === "active" && Number(quiz.endsAt) > now,
      resolvedMarks: [...(state.resolvedMarks || [])],
      effect: state.effect || null,
      quiz: quiz ? {
        id: quiz.id,
        mark: quiz.mark,
        status: quiz.status,
        startedAt: quiz.startedAt,
        endsAt: quiz.endsAt,
        remainingMs: quiz.status === "active" ? Math.max(0, Number(quiz.endsAt) - now) : 0,
        question: publicQuestion(question, resolved),
        answers,
        result: quiz.result || null,
      } : null,
      serverNow: now,
    };
  }
}

module.exports = { HutaoEventService, defaultState };
