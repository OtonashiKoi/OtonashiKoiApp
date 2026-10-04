"use strict";
const { randomBytes, createHash } = require("crypto");
const fs = require("fs"), path = require("path");
const clone = structuredClone;
// A restart replays only committed actions against frozen inputs. Never persist a
// partially advanced generator, and never re-roll a committed hit or cooldown.
const root = path.resolve(__dirname, "../..");
const codeVersion = createHash("sha256").update([
  path.join(root, "bot/handlers/towerHandlers.js"),
  ...fs.readdirSync(path.join(root, "shared")).filter(n => n.endsWith(".js")).sort().map(n => path.join(root, "shared", n)),
].map(p => fs.readFileSync(p)).join("\n")).digest("hex");
const externalFields = ["currentHp", "strategy", "bardStreak", "bardLevel", "partyEnvironment"];
const combatFields = ["currentHp", "activeEffects", "cardCooldowns", "jobSkillCooldowns", "jobSkillsUsedThisBattle",
  "partyJobState", "partyJobView", "floorSkillComboSpent", "floorAttackRounds", "bardStreak", "bardLevel", "strategy"];
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function scopedNext(cache, time) {
  const oldRandom = Math.random, oldNow = Date.now;
  try { Math.random = cache.random; Date.now = () => time; return cache.iterator.next(); }
  finally { Math.random = oldRandom; Date.now = oldNow; }
}
function createLiveCombat() {
  const caches = new Map();
  function initialize(room, monster, floor, time) {
    room.liveCombat = { codeVersion, floor, monster: clone(monster), seed: randomBytes(4).readUInt32LE(),
      initialMembers: clone(room.members), actionCount: 0, actions: [] };
    room.playbackStartedAt = time;
  }
  function cacheFor(room) {
    const state = room.liveCombat, key = `${room.runId}:${state.floor}`;
    let cache = caches.get(room._id);
    if (cache?.key === key && cache.count === state.actionCount) return cache;
    if (state.codeVersion !== codeVersion) throw new Error("戰鬥核心版本已更新，本層停止並保留已通關獎勵");
    const members = clone(state.initialMembers);
    cache = { key, members, count: 0, random: makeRandom(state.seed),
      iterator: require("../../bot/handlers/towerHandlers").iterateFloor({ partyV2: true, currentFloor: state.floor, members },
        state.monster, state.monster.calc.maxHp, state.monster.calc.atk) };
    for (const recorded of state.actions) {
      for (const patch of recorded.inputs) Object.assign(members.find(m => m.discordId === patch.id), clone(patch.fields));
      const step = scopedNext(cache, recorded.time);
      if (step.done || createHash("sha256").update(JSON.stringify(step.value)).digest("hex") !== recorded.hash) throw new Error("戰鬥恢復校驗失敗，本層停止並保留已通關獎勵");
      cache.count++;
    }
    caches.set(room._id, cache); return cache;
  }
  function advance(room, time) {
    const cache = cacheFor(room), state = room.liveCombat, inputs = [];
    for (const current of room.members) {
      const member = cache.members.find(m => m.discordId === current.discordId), fields = {};
      for (const key of externalFields) if (JSON.stringify(current[key]) !== JSON.stringify(member[key])) fields[key] = clone(current[key]);
      if (Object.keys(fields).length) { inputs.push({ id: current.discordId, fields }); Object.assign(member, clone(fields)); }
    }
    const step = scopedNext(cache, time);
    let result = step.done ? step.value : null;
    if (!step.done) {
      state.actions.push({ inputs, time, hash: createHash("sha256").update(JSON.stringify(step.value)).digest("hex") });
      state.actionCount++; cache.count++;
      if (step.value.monsterHpAfter <= 0 || cache.members.every(m => m.currentHp <= 0)) result = scopedNext(cache, time).value;
    }
    for (const current of room.members) {
      const member = cache.members.find(m => m.discordId === current.discordId);
      for (const key of combatFields) if (member[key] !== undefined) current[key] = clone(member[key]);
    }
    return { action: step.done ? null : step.value, result };
  }
  return { initialize, advance, forget: room => caches.delete(room._id) };
}
module.exports = { createLiveCombat, codeVersion };
