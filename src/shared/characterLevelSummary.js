"use strict";

const CHARACTER_SLOTS = [1, 2, 3];

function activeCharacterSlot(progress) {
  const slot = Number(progress?.activeCharacterSlot);
  return CHARACTER_SLOTS.includes(slot) ? slot : 1;
}

function reachedMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function snapshotForSlot(progress, slot) {
  if (!progress || typeof progress !== "object") return null;
  if (slot === activeCharacterSlot(progress)) return progress;
  const stored = progress.characterSlots && typeof progress.characterSlots === "object"
    ? progress.characterSlots[String(slot)]
    : null;
  return stored && typeof stored === "object" ? stored : null;
}

function characterJobName(snapshot) {
  return String(
    snapshot?.equipment?.job_eq?.itemName
    || snapshot?.equipment?.job_eq?.name
    || snapshot?.job
    || ""
  );
}

function summarizeCharacterLevels(progress) {
  const characters = CHARACTER_SLOTS
    .map((slot) => {
      const snapshot = snapshotForSlot(progress, slot);
      if (!snapshot) return null;
      return {
        slot,
        level: Math.max(1, Number(snapshot.level) || 1),
        exp: Math.max(0, Number(snapshot.exp) || 0),
        levelReachedAt: snapshot.levelReachedAt || null,
        jobName: characterJobName(snapshot),
      };
    })
    .filter(Boolean);

  // 舊玩家一定至少有頂層角色資料；這個 fallback 只防止異常空文件讓排行榜報錯。
  if (characters.length === 0) {
    characters.push({ slot: 1, level: 1, exp: 0, levelReachedAt: null, jobName: "" });
  }

  const highest = [...characters].sort((a, b) => (
    b.level - a.level
    || reachedMs(a.levelReachedAt) - reachedMs(b.levelReachedAt)
    || b.exp - a.exp
    || a.slot - b.slot
  ))[0];

  return {
    highestSlot: highest.slot,
    highestLevel: highest.level,
    highestExp: highest.exp,
    highestLevelReachedAt: highest.levelReachedAt,
    highestJobName: highest.jobName,
    totalLevel: characters.reduce((sum, character) => sum + character.level, 0),
    totalExp: characters.reduce((sum, character) => sum + character.exp, 0),
    characterCount: characters.length,
    characterLevels: characters.map(({ slot, level }) => ({ slot, level })),
  };
}

module.exports = {
  CHARACTER_SLOTS,
  activeCharacterSlot,
  snapshotForSlot,
  summarizeCharacterLevels,
  reachedMs,
};
