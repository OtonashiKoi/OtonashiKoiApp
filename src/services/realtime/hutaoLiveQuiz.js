"use strict";
const rules = require("../../shared/hutaoEvent");
const { normalMaxHp } = require("../monster/normalCoopScaling");
const { ZONE } = require("./hutaoLiveEntry");

async function initializeRun(sc, state) {
  try { await sc.hutaoEventService.ensureRun(state.normalLive.encounterKey); }
  catch (error) { console.error("[HutaoQuiz] run initialization pending", error); }
}

async function beforeAdvance(engine, room, state) {
  if (room.zone !== ZONE) return false;
  const service = room.sc.hutaoEventService;
  let event = await service.ensureRun(state.normalLive?.encounterKey);
  const mark = Number(state.normalLive?.hutaoQuizMark);
  if (rules.RIICHI_MARKS.includes(mark) && !event.resolvedMarks.includes(mark) && !event.blocking)
    event = await service.startQuiz(mark, state.normalLive.encounterKey, engine.now());
  room.hutaoEvent = event;
  room.quizBlockingUntil = event.blocking ? Number(event.quiz.endsAt) : 0;
  if (event.blocking) return true;
  if (!event.effect?.hpCrush || state.normalLive?.hutaoCrushPulseId === event.effect.pulseId) return false;
  const candidate = structuredClone(state);
  for (const actor of Object.values(candidate.normalLive.actors || {})) {
    if (Number(actor.hp) > 0) actor.hp = Math.min(actor.hp, Math.max(1, Math.floor(Number(actor.maxHp || 1) * .01)));
  }
  candidate.normalLive.hutaoCrushPulseId = event.effect.pulseId;
  if (!await room.sc.monsterService.saveStateIfActiveMonster(candidate,room.zone,room.seq,state.currentHp)) return true;
  for (const a of room.members.values()) {
    const saved = candidate.normalLive.actors[a.actorId];
    if (saved) a.hp = saved.hp;
  }
  engine.updateScene(room,candidate,[],[]);
  return true;
}

function threshold(room, state) {
  if (room.zone !== ZONE) return { mark: null, hp: 0 };
  const mark = rules.RIICHI_MARKS.find(value => !room.hutaoEvent.resolvedMarks.includes(value));
  return { mark, hp: mark ? rules.hpAtMark(normalMaxHp(state,room.monster),mark) : 0 };
}

async function afterCommit(room, state, at, mark) {
  if (room.zone !== ZONE || !mark || state.normalLive?.hutaoQuizMark !== mark) return;
  try {
    room.hutaoEvent = await room.sc.hutaoEventService.startQuiz(mark,state.normalLive.encounterKey,at);
    room.quizBlockingUntil = Number(room.hutaoEvent.quiz?.endsAt) || 0;
  } catch (error) {
    // HP and mark already committed; the next clock retries this marker.
    console.error("[HutaoQuiz] start pending", error);
  }
}

module.exports = { initializeRun, beforeAdvance, threshold, afterCommit };
