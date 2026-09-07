"use strict";

const _resolveZoneEventIfExpired = (...args) => require("./zoneTransitions")._resolveZoneEventIfExpired(...args);
const pickWeightedNextMonster = (...args) => require("./zoneTransitions").pickWeightedNextMonster(...args);
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");
const createWorldBossPartHpTemplate = (...args) => require("./bossMechanics").createWorldBossPartHpTemplate(...args);
const _republishPanel = (...args) => require("./battlePresentation")._republishPanel(...args);
const { BOSS_SPAWN_BROADCAST_ENABLED } = require("./zoneBattleState");
const _broadcastBossSpawn = (...args) => require("./battlePresentation")._broadcastBossSpawn(...args);
const announceIdleRotate = (...args) => require("./battlePresentation").announceIdleRotate(...args);

async function _doIdleRotate(sc, zoneKey) {
  try {
    if (process.env.DISABLE_AUTO_ROTATE === '1') {
      return;
    }
    let state = await sc.monsterService.getState(zoneKey);
    await _resolveZoneEventIfExpired(sc, zoneKey).catch(() => {});
    state = await sc.monsterService.getState(zoneKey);
    if (state?.activeEvent?.endsAt && Date.parse(state.activeEvent.endsAt) > Date.now()) return;
    const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    const monster = allMonsters.find((m) => m.seq === state.activeMonsterSeq);
    if (!monster) return;

    const next = pickWeightedNextMonster(allMonsters, monster.id);
    if (!next) return;

    const newState = {
      ...state,
      currentHp: next.calc.maxHp,
      activeMonsterSeq: next.seq,
      participants: [],
      damageMap: {},
      killClaimedSeq: null,
      lastHitAt: new Date().toISOString(),
      activeEvent: null,
    };

    // 精英區世界 Boss idle：重置三部位 HP
    // 只有「有人開戰但超時」才重置解鎖進度，純閒置不重置
    if (isWorldBossZone(zoneKey) && next.isBoss && sc.worldBossServiceFor(zoneKey)) {
      const partMax = createWorldBossPartHpTemplate(next.calc.maxHp, zoneKey);
      newState.worldBossPartsMaxHp = partMax;
      newState.worldBossPartsHp = { ...partMax };
      const wbState = await sc.worldBossServiceFor(zoneKey)._getStateEnsured().catch(() => null);
      if (wbState?.battleStartedAt) {
        // 有人曾開戰但沒打完，視為失敗，重置解鎖進度
        await sc.worldBossServiceFor(zoneKey).markBossFailedTimeout().catch(() => {});
      } else {
        // 純閒置，只重置部位 HP，不動解鎖進度
      }
    }

    await sc.monsterService.saveState(newState, zoneKey);
    _republishPanel(sc, zoneKey, next, next.calc.maxHp, 0, {}).catch(() => {});
    // 精英區 Boss 由解鎖流程觸發廣播，idle rotate 不廣播
  if (next.isBoss && !isWorldBossZone(zoneKey) && BOSS_SPAWN_BROADCAST_ENABLED) _broadcastBossSpawn(sc, zoneKey, next).catch(() => {});

    await announceIdleRotate(sc, zoneKey, monster);
  } catch (e) {
    console.error(`[IdleRotate] zone=${zoneKey} error:`, e.message);
  }
}

module.exports = { _doIdleRotate };
