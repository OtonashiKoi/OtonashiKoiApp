"use strict";
const { monsterTransitionTimers } = require("./zoneBattleState");
const { MONSTER_TRANSITION_MS } = require("./zoneBattleState");
const { activeMonsterTransitions } = require("./zoneBattleState");
const _republishPanel = (...args) => require("./battlePresentation")._republishPanel(...args);
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");
const { BOSS_SPAWN_BROADCAST_ENABLED } = require("./zoneBattleState");
const _broadcastBossSpawn = (...args) => require("./battlePresentation")._broadcastBossSpawn(...args);

const { zoneEventTimers } = require("./zoneBattleState");

const ensureWorldBossPartState = (...args) => require("./bossMechanics").ensureWorldBossPartState(...args);
const freshHellfangFields = (...args) => require("./bossMechanics").freshHellfangFields(...args);

async function _startMonsterTransition(sc, zoneKey, nextMonster, freshState, { sourceMonsterName = null, sourceMonsterSeq = null } = {}) {
  if (!nextMonster) return null;

  const prevTimer = monsterTransitionTimers.get(zoneKey);
  if (prevTimer) clearTimeout(prevTimer);

  const transitionId = require("crypto").randomUUID();
  const diceRoll = Math.floor(Math.random() * 100) + 1;
  const startedAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + MONSTER_TRANSITION_MS).toISOString();

  const transitionState = {
    ...freshState,
    currentHp: 0,
    activeMonsterSeq: freshState?.activeMonsterSeq ?? nextMonster.seq,
    killCount: freshState?.killCount || {},
    participants: [],
    damageMap: {},
    killClaimedSeq: sourceMonsterSeq ?? freshState?.activeMonsterSeq ?? nextMonster.seq,
    killClaimedAt: new Date(),
    activeHealerAura: null,
    activeEvent: null,
    activeTransition: {
      id: transitionId,
      kind: "monster_switch",
      startedAt,
      endsAt,
      diceRoll,
      nextMonsterSeq: nextMonster.seq,
      nextMonsterName: nextMonster.name,
      sourceMonsterName
    }
  };

  activeMonsterTransitions.set(zoneKey, transitionState.activeTransition);
  await sc.monsterService.saveState(transitionState, zoneKey);
  // Discord 面板是戰後展示，不影響換怪狀態；不得讓 Discord API 延遲卡住 Web 戰報。
  _republishPanel(
    sc,
    zoneKey,
    null,
    0,
    0,
    {},
    null,
    null,
    { activeTransition: transitionState.activeTransition }
  ).catch(() => {});

  const timer = setTimeout(async () => {
    try {
      const latestState = await sc.monsterService.getState(zoneKey).catch(() => null);
      if (latestState?.activeTransition?.id !== transitionId) return;

      const nextState = {
        ...latestState,
        currentHp: nextMonster.calc.maxHp,
        activeMonsterSeq: nextMonster.seq,
        killCount: latestState?.killCount || transitionState.killCount || {},
        participants: [],
        damageMap: {},
        killClaimedSeq: nextMonster.seq === (sourceMonsterSeq ?? latestState?.activeMonsterSeq) ? null : (latestState?.killClaimedSeq ?? sourceMonsterSeq ?? transitionState.killClaimedSeq ?? null),
        killClaimedAt: nextMonster.seq === (sourceMonsterSeq ?? latestState?.activeMonsterSeq) ? null : (latestState?.killClaimedAt ?? transitionState.killClaimedAt ?? null),
        activeHealerAura: null,
        activeEvent: null,
        activeTransition: null,
        lastHitAt: new Date().toISOString()
      };

      let worldBossPartsHp = null;
      if (isWorldBossZone(zoneKey) && nextMonster?.isBoss) {
        const partState = ensureWorldBossPartState({}, nextMonster.calc.maxHp, zoneKey);
        nextState.currentHp = partState.currentHp;
        nextState.worldBossPartsHp = partState.worldBossPartsHp;
        nextState.worldBossPartsMaxHp = partState.worldBossPartsMaxHp;
        worldBossPartsHp = partState.worldBossPartsHp;
        Object.assign(nextState, freshHellfangFields()); // 牙狼重生：清翻面/累積
      }

      await sc.monsterService.saveState(nextState, zoneKey);
      await _republishPanel(
        sc,
        zoneKey,
        nextMonster,
        nextState.currentHp,
        0,
        {},
        null,
        worldBossPartsHp
      ).catch(() => {});

      if (nextMonster.isBoss && !isWorldBossZone(zoneKey) && BOSS_SPAWN_BROADCAST_ENABLED) {
        _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
      }
      } catch (e) {
        console.error(`[MonsterTransition] finalize failed zone=${zoneKey}:`, e?.message || e);
      } finally {
        const current = monsterTransitionTimers.get(zoneKey);
        if (current) clearTimeout(current);
        monsterTransitionTimers.delete(zoneKey);
        const currentTransition = activeMonsterTransitions.get(zoneKey);
        if (currentTransition?.id === transitionId) {
          activeMonsterTransitions.delete(zoneKey);
        }
      }
  }, MONSTER_TRANSITION_MS);

  monsterTransitionTimers.set(zoneKey, timer);
  return transitionState.activeTransition;
}

async function _resolveExpiredMonsterTransition(sc, zoneKey) {
  const state = await sc.monsterService.getState(zoneKey).catch(() => null);
  const transition = state?.activeTransition || null;
  if (!transition && activeMonsterTransitions.has(zoneKey)) {
    activeMonsterTransitions.delete(zoneKey);
    const timer = monsterTransitionTimers.get(zoneKey);
    if (timer) clearTimeout(timer);
    monsterTransitionTimers.delete(zoneKey);
  }
  if (!transition || !transition.endsAt) return false;

  const endAtMs = Date.parse(transition.endsAt);
  if (!Number.isFinite(endAtMs) || endAtMs > Date.now()) return false;

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey }).catch(() => []);
  if (!allMonsters.length) {
    const cleared = {
      ...state,
      currentHp: 0,
      participants: [],
      damageMap: {},
      killClaimedSeq: null,
      activeEvent: null,
      activeTransition: null,
      lastHitAt: new Date().toISOString()
    };
    await sc.monsterService.saveState(cleared, zoneKey);
    return true;
  }

  let nextMonster = allMonsters.find((m) => Number(m.seq) === Number(transition.nextMonsterSeq));
  if (!nextMonster) {
    nextMonster = allMonsters.find((m) => Number(m.seq) === Number(state?.activeMonsterSeq)) || allMonsters[0];
  }
  if (!nextMonster) return false;

  const nextState = {
    ...state,
    activeMonsterSeq: nextMonster.seq,
    currentHp: nextMonster.calc.maxHp,
    participants: [],
    damageMap: {},
    killClaimedSeq: null,
    activeEvent: null,
    activeTransition: null,
    lastHitAt: new Date().toISOString()
  };

  let worldBossPartsHp = null;
  if (isWorldBossZone(zoneKey) && nextMonster?.isBoss) {
    const partState = ensureWorldBossPartState({}, nextMonster.calc.maxHp, zoneKey);
    nextState.currentHp = partState.currentHp;
    nextState.worldBossPartsHp = partState.worldBossPartsHp;
    nextState.worldBossPartsMaxHp = partState.worldBossPartsMaxHp;
    worldBossPartsHp = partState.worldBossPartsHp;
    Object.assign(nextState, freshHellfangFields()); // 牙狼重生：清翻面/累積
  }

  await sc.monsterService.saveState(nextState, zoneKey);
  await _republishPanel(
    sc,
    zoneKey,
    nextMonster,
    nextState.currentHp,
    0,
    {},
    null,
    worldBossPartsHp
  ).catch(() => {});

  if (nextMonster.isBoss && !isWorldBossZone(zoneKey) && BOSS_SPAWN_BROADCAST_ENABLED) {
    _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
  }

  return true;
}

async function _resolveZoneEventIfExpired(sc, zoneKey) {
  const state = await sc.monsterService.getState(zoneKey);
  const activeEvent = state?.activeEvent;
  if (!activeEvent) return false;

  // 如果沒有 endsAt 或解析失敗，強制清除（防止事件卡住）
  if (!activeEvent.endsAt) {
    console.warn(`[NPC Event] Event has no endsAt, forcing cleanup: ${activeEvent.name || 'unknown'}`);
    const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    if (allMonsters.length) {
      const current = allMonsters.find((m) => m.seq === state.activeMonsterSeq) || allMonsters[0];
      const nextMonster = pickWeightedNextMonster(allMonsters, current.id);
      await sc.monsterService.saveState(
        {
          ...state,
          activeMonsterSeq: nextMonster.seq,
          currentHp: nextMonster.calc.maxHp,
          participants: [],
          damageMap: {},
          killClaimedSeq: null,
          activeEvent: null,
          lastHitAt: new Date().toISOString()
        },
        zoneKey
      );
      _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {}, null).catch(() => {});
      zoneEventTimers.delete(zoneKey);
      return true;
    }
    return false;
  }

  const endAtMs = Date.parse(activeEvent.endsAt);
  if (!Number.isFinite(endAtMs)) {
    console.error(`[NPC Event] Invalid endsAt format: ${activeEvent.endsAt}, forcing cleanup`);
    // 時間格式無效，強制清除
    await sc.monsterService.saveState({ ...state, activeEvent: null }, zoneKey);
    zoneEventTimers.delete(zoneKey);
    return true;
  }
  if (endAtMs > Date.now()) return false;

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
  if (!allMonsters.length) return false;

  let nextMonster = allMonsters.find((m) => m.seq === Number(activeEvent.pendingMonsterSeq));
  if (!nextMonster) {
    const current = allMonsters.find((m) => m.seq === state.activeMonsterSeq) || null;
    nextMonster = pickWeightedNextMonster(allMonsters, current?.id || null);
  }
  if (!nextMonster) return false;

  const nextState = {
    ...state,
    activeMonsterSeq: nextMonster.seq,
    currentHp: nextMonster.calc.maxHp,
    participants: [],
    damageMap: {},
    killClaimedSeq: null,
    lastHitAt: new Date().toISOString(),
    activeEvent: null
  };
  await sc.monsterService.saveState(nextState, zoneKey);
  _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {}, null).catch(() => {});
  if (nextMonster.isBoss && BOSS_SPAWN_BROADCAST_ENABLED) _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
  zoneEventTimers.delete(zoneKey);
  return true;
}

function _scheduleZoneEventFinalize(sc, zoneKey, endsAt) {
  if (!endsAt) return;
  const dueMs = Math.max(1000, Date.parse(endsAt) - Date.now() + 300);
  const prev = zoneEventTimers.get(zoneKey);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    _resolveZoneEventIfExpired(sc, zoneKey).catch((error) => {
      console.error(`[MonsterZone] resolve event failed zone=${zoneKey}`, error);
    });
  }, dueMs);
  zoneEventTimers.set(zoneKey, timer);
}

function pickWeightedNextMonster(monsters, currentMonsterId = null) {
  if (!Array.isArray(monsters) || monsters.length === 0) return null;
  const pool = monsters.filter((m) => m.id !== currentMonsterId || monsters.length === 1);
  if (!pool.length) return null;
  const totalWeight = pool.reduce((s, m) => s + (m.spawnRate || 10), 0);
  let r = Math.random() * Math.max(1, totalWeight);
  let selected = pool[pool.length - 1];
  for (const m of pool) {
    r -= (m.spawnRate || 10);
    if (r <= 0) {
      selected = m;
      break;
    }
  }
  return selected || null;
}
module.exports = { _startMonsterTransition, _resolveExpiredMonsterTransition, _resolveZoneEventIfExpired, _scheduleZoneEventFinalize, pickWeightedNextMonster };
