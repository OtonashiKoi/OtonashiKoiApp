"use strict";

const { ensureWorldBossPartState } = require("../../bot/handlers/monsterZoneHandlers");
const { CHARACTER_SLOTS } = require("../../shared/membershipEntitlements");

function taipeiDateKey(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

function normalizeState(cur, boss, today = taipeiDateKey()) {
  if (cur.dateKey !== today) {
    const seed = ensureWorldBossPartState({}, boss.maxHp, boss.zone);
    return {
      dateKey: today,
      killsToday: 0,
      worldBossPartsHp: seed.worldBossPartsHp,
      worldBossPartsMaxHp: seed.worldBossPartsMaxHp,
    };
  }
  const ensured = ensureWorldBossPartState(
    { worldBossPartsHp: cur.worldBossPartsHp, worldBossPartsMaxHp: cur.worldBossPartsMaxHp },
    boss.maxHp,
    boss.zone
  );
  return {
    dateKey: today,
    killsToday: Math.max(0, Number(cur.killsToday) || 0),
    worldBossPartsHp: ensured.worldBossPartsHp,
    worldBossPartsMaxHp: ensured.worldBossPartsMaxHp,
  };
}

// 舊版把單人王存在人物快照。首次讀取時把所有人物今天的擊殺數合併，並取各部位
// 最低 HP；之後 accountSoloBoss 成為唯一來源，切人物不會重置每日次數或戰鬥進度。
function readAccountState(progress, boss) {
  const today = taipeiDateKey();
  const accountAll = progress?.accountSoloBoss && typeof progress.accountSoloBoss === "object"
    ? progress.accountSoloBoss
    : {};
  const accountRaw = accountAll[boss.key];
  if (accountRaw && typeof accountRaw === "object") {
    return {
      state: normalizeState(accountRaw, boss, today),
      needsSave: accountRaw.dateKey !== today,
    };
  }

  const activeSlot = CHARACTER_SLOTS.includes(Number(progress?.activeCharacterSlot))
    ? Number(progress.activeCharacterSlot)
    : 1;
  const legacy = [];
  const activeRaw = progress?.soloBoss?.[boss.key];
  if (activeRaw?.dateKey === today) legacy.push(activeRaw);
  for (const slot of CHARACTER_SLOTS) {
    if (slot === activeSlot) continue;
    const raw = progress?.characterSlots?.[String(slot)]?.soloBoss?.[boss.key];
    if (raw?.dateKey === today) legacy.push(raw);
  }

  if (!legacy.length) return { state: normalizeState({}, boss, today), needsSave: true };
  const states = legacy.map((raw) => normalizeState(raw, boss, today));
  const seed = normalizeState({}, boss, today);
  const mergedHp = {};
  for (const key of Object.keys(seed.worldBossPartsHp)) {
    mergedHp[key] = Math.min(...states.map((st) => Math.max(0, Number(st.worldBossPartsHp[key]) || 0)));
  }
  return {
    state: {
      dateKey: today,
      killsToday: Math.min(boss.killsPerDay, states.reduce((sum, st) => sum + st.killsToday, 0)),
      worldBossPartsHp: mergedHp,
      worldBossPartsMaxHp: seed.worldBossPartsMaxHp,
    },
    needsSave: true,
  };
}

module.exports = { taipeiDateKey, normalizeState, readAccountState };
