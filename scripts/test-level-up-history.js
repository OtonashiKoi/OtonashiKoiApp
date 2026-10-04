"use strict";

const assert = require("node:assert/strict");
const { ProgressService } = require("../src/services/progress/progressService");
const { createGameProgress } = require("../src/domain/progress/createGameProgress");
const { expToNextLevel } = require("../src/shared/progression");
const { takeCharacterSnapshot, CHARACTER_PROGRESS_KEYS } = require("../src/services/character/characterService");
const { buildProgressResetUpdate } = require("../src/services/admin/seasonResetPolicy");

async function main() {
  let progress = createGameProgress("level-history-test");
  let failOnce = true;
  const repository = {
    async saveIfUnchanged(next) {
      if (failOnce) { failOnce = false; return false; }
      progress = structuredClone(next);
      return true;
    },
  };
  const playerService = { async ensurePlayer() { return { player: {}, progress: structuredClone(progress) }; } };
  const service = new ProgressService(playerService, repository);
  const first = await service.grantExp({ discordId: "level-history-test", displayName: "test", amount: expToNextLevel(1), source: "monster:kill" });
  assert.equal(first.levelUps, 1);
  assert.equal(first.levelUpDetails[0].attrs.length, 1, "each level grants exactly one random attribute");
  assert.equal(first.levelUpDetails[0].freePoints, 1, "each level grants one allocatable point");
  assert.equal(Object.values(progress.attributes).reduce((sum, value) => sum + value, 0), 7);
  assert.equal(progress.statusPoints, 1);
  assert.equal(progress.levelUpHistory.length, 1, "CAS retry must not duplicate a record");
  assert.equal(progress.levelUpHistory[0].fromLevel, 1);
  assert.equal(progress.levelUpHistory[0].toLevel, 2);
  assert.equal(progress.levelUpHistory[0].reachedAt, progress.levelReachedAt);
  assert.equal(progress.levelUpHistory[0].startedAt !== null, true);
  assert.equal(progress.levelUpHistory[0].elapsedMs >= 0, true);
  const second = await service.grantExp({ discordId: "level-history-test", displayName: "test", amount: expToNextLevel(2) + expToNextLevel(3), source: "monster:kill" });
  assert.equal(second.levelUps, 2);
  assert.deepEqual(second.levelUpDetails.map((detail) => [detail.attrs.length, detail.freePoints]), [[1, 1], [1, 1]]);
  assert.equal(Object.values(progress.attributes).reduce((sum, value) => sum + value, 0), 9);
  assert.equal(progress.statusPoints, 3);
  assert.deepEqual(progress.levelUpHistory.map(x => x.toLevel), [2, 3, 4]);
  assert.equal(progress.levelUpHistory[2].elapsedMs, 0);
  assert.equal(progress.levelUpHistory[2].timingBasis, "same_reward");
  const snapshot = takeCharacterSnapshot(progress);
  assert.equal(CHARACTER_PROGRESS_KEYS.includes("levelUpHistory"), true);
  assert.deepEqual(snapshot.levelUpHistory, progress.levelUpHistory);
  const reset = buildProgressResetUpdate(progress, new Date().toISOString(), { seasonKey: "test-next" });
  assert.deepEqual(reset.$set.levelUpHistory, []);
  assert.equal(reset.$set.levelStartedAt, null);
  console.log("level-up history: CAS, multi-level reward, character snapshot, and season reset passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
