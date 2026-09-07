"use strict";

const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");

const ensureWorldBossPartState = (...args) => require("./bossMechanics").ensureWorldBossPartState(...args);
const freshHellfangFields = (...args) => require("./bossMechanics").freshHellfangFields(...args);
const clearQueuedEliteWorldBossSessions = (...args) => require("./battlePresentation").clearQueuedEliteWorldBossSessions(...args);
const { worldBossTimeoutTimers } = require("./zoneBattleState");
const _republishPanel = (...args) => require("./battlePresentation")._republishPanel(...args);
const _awardWorldBossContributionChests = (...args) => require("./worldBossChestRewards")._awardWorldBossContributionChests(...args);
const buildPartyRewardSummary = (...args) => require("./battleRewardView").buildPartyRewardSummary(...args);
const _notifyKillRewards = (...args) => require("./battlePresentation")._notifyKillRewards(...args);
const pickWeightedNextMonster = (...args) => require("./zoneTransitions").pickWeightedNextMonster(...args);
const { zoneLastChosen } = require("./zoneBattleState");
const _scheduleZoneEventFinalize = (...args) => require("./zoneTransitions")._scheduleZoneEventFinalize(...args);
const _startMonsterTransition = (...args) => require("./zoneTransitions")._startMonsterTransition(...args);

async function finishMonsterKill(context) {
  const { state, monster, sc, zoneKey, mergedDmg, perPidRewards, rewardLines, discordId } = context;
  // 擊殺數 + 推進下一隻怪物
  const newKillCount = { ...(state.killCount || {}), [monster.id]: ((state.killCount?.[monster.id] || 0) + 1) };
  // 取最新 state 以免多人並發時覆蓋其他人的 damageMap
  const freshState = await sc.monsterService.getState(zoneKey);
  const finalDamageMap = { ...(freshState.damageMap || {}), ...mergedDmg };

  // 世界 BOSS（精英區）擊殺後：同一隻進入冷卻，不切下一隻
  if (isWorldBossZone(zoneKey) && monster?.isBoss && sc.worldBossServiceFor(zoneKey)) {
    const resetParts = ensureWorldBossPartState({}, monster.calc.maxHp, zoneKey);
    const wbConfig = await sc.worldBossServiceFor(zoneKey).getConfig().catch(() => null);
    const bossLockMs = Math.max(1, Number(wbConfig?.respawnCooldownMinutes || 60)) * 60 * 1000;
    const bossLockUntil = new Date(Date.now() + bossLockMs + 15 * 1000);
    const bossResetState = {
      ...freshState,
      ...freshHellfangFields(), // 牙狼重生：清翻面/累積
      currentHp: resetParts.currentHp,
      worldBossPartsHp: resetParts.worldBossPartsHp,
      worldBossPartsMaxHp: resetParts.worldBossPartsMaxHp,
      activeMonsterSeq: monster.seq,
      killCount: newKillCount,
      participants: [],
      damageMap: {},
      // 保留「上一隻」的傷害排行：冷卻期間網頁/DC 仍顯示剛擊殺這隻王的排行，下一隻被打才換新
      lastDamageMap: (freshState.damageMap && Object.keys(freshState.damageMap).length > 0) ? freshState.damageMap : (freshState.lastDamageMap || {}),
      lastParticipants: Array.isArray(freshState.participants) ? freshState.participants : [],
      killClaimedSeq: monster.seq,
      killClaimedAt: bossLockUntil,
      killClaimedBy: "elite-boss-cooldown",
      activeHealerAura: null,
      activeHealerAuras: [],
      activeEvent: null
    };
    await sc.monsterService.saveState(bossResetState, zoneKey);
    await sc.worldBossServiceFor(zoneKey).markBossKilled().catch(() => {});
    const clearedQueued = clearQueuedEliteWorldBossSessions();
    if (clearedQueued > 0) {
      console.log(`[WorldBoss] cleared queued elite sessions after kill: ${clearedQueued}`);
    }
    const timeoutTimer = worldBossTimeoutTimers.get(zoneKey);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      worldBossTimeoutTimers.delete(zoneKey);
    }
    _republishPanel(sc, zoneKey, monster, bossResetState.currentHp, 0, {}, null, bossResetState.worldBossPartsHp).catch(() => {});

    // 世界王貢獻寶箱：本王傷害 + 0.7×助攻排名前 6 名，依名次領 1~4 箱。
    await _awardWorldBossContributionChests(
      sc, zoneKey, monster, freshState.damageMap, perPidRewards,
      Array.isArray(freshState.participants) ? freshState.participants : []
    );

    rewardLines.push(...buildPartyRewardSummary(perPidRewards, mergedDmg));
    _notifyKillRewards(monster.name, perPidRewards).catch((e) => console.error("[NotifyKill] top-level error:", e?.message || e));

    try {
      const pushReward = sc._pushRewardToPlayer;
      if (typeof pushReward === "function") {
        for (const [pid, rewards] of Object.entries(perPidRewards)) {
          if (!rewards.gold && !rewards.exp && !rewards.drops?.length) continue;
          pushReward(pid, {
            monsterName: monster.name,
            gold: rewards.gold,
            exp: rewards.exp,
            levelUps: rewards.levelUps,
            newLevel: rewards.newLevel,
            drops: rewards.drops
          });
        }
      }
    } catch (_) {}

    const myReward = perPidRewards[discordId] || { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
    rewardLines._summary = {
      gold: myReward.gold,
      exp: myReward.exp,
      levelUps: myReward.levelUps,
      newLevel: myReward.newLevel,
      drops: myReward.drops
    };
    return rewardLines;
  }

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
  const nextMonster = pickWeightedNextMonster(allMonsters, monster.id);
  const npcMappingsSource = Array.isArray(freshState.npcMappings) ? freshState.npcMappings : [];
  const allEvents = npcMappingsSource.length
    ? await sc.monsterEventService.listEvents({ zone: zoneKey, includeDisabled: true }).catch(() => [])
    : [];
  const mappingPool = [];
  for (const [index, mp] of npcMappingsSource.entries()) {
    if (mp.triggerMonsterSeq != null && Number(mp.triggerMonsterSeq) !== Number(monster.seq)) continue;
    const tpl = allEvents.find((e) => e.id === mp.eventId) || null;
    if (!tpl) continue;
    mappingPool.push({
      id: mp.eventId || null,
      chance: Number(mp.chance) || 0,
      order: Number.isFinite(Number(mp.order)) ? Number(mp.order) : index,
      triggerMonsterSeq: mp.triggerMonsterSeq == null ? null : Number(mp.triggerMonsterSeq),
      template: tpl
    });
  }

  if (mappingPool.length > 0) {
    const sortedNpcPool = mappingPool.sort((a, b) => a.order - b.order);
    const lastChosen = zoneLastChosen.get(zoneKey) || null;
    let monsterPool = allMonsters.filter((m) => m.id !== monster.id || allMonsters.length === 1);
    let eventPool = sortedNpcPool;
    const monsterWeights = monsterPool.map((m) => Number(m.spawnRate) || 10);
    if (lastChosen) {
      const lastType = lastChosen.type;
      const lastId = lastChosen.id;
      const filteredMonsterPool = monsterPool.filter((m) => !(lastType === "monster" && m.id === lastId));
      const filteredEventPool = eventPool.filter((e) => !(lastType === "event" && e.id === lastId));
      if (filteredMonsterPool.length || filteredEventPool.length) {
        monsterPool = filteredMonsterPool.length ? filteredMonsterPool : monsterPool;
        eventPool = filteredEventPool.length ? filteredEventPool : eventPool;
      }
    }
    const eventWeights = eventPool.map((e) => Number(e.chance) || 0);
    const totalMonsterWeight = monsterWeights.reduce((s, v) => s + v, 0);
    const totalEventWeight = eventWeights.reduce((s, v) => s + v, 0);
    const totalWeight = totalMonsterWeight + totalEventWeight;
    let chosenEvent = null;
    let chosenMonster = null;
    if (totalWeight <= 0) {
      chosenMonster = nextMonster;
    } else {
      let r = Math.random() * totalWeight;
      for (let i = 0; i < monsterPool.length; i++) {
        r -= monsterWeights[i] || 0;
        if (r <= 0) {
          chosenMonster = monsterPool[i];
          break;
        }
      }
      if (!chosenMonster) {
        for (let j = 0; j < eventPool.length; j++) {
          r -= eventWeights[j] || 0;
          if (r <= 0) {
            chosenEvent = eventPool[j];
            break;
          }
        }
      }
    }

    if (chosenEvent) {
      zoneLastChosen.set(zoneKey, { type: "event", id: chosenEvent.id });
      const pendingMonster = nextMonster;
      const tpl = chosenEvent.template || null;
      const startedAt = new Date().toISOString();
      const endsAt = new Date(Date.now() + ((tpl && tpl.durationSec) || 12) * 1000).toISOString();
      const eventState = {
        ...freshState,
        killCount: newKillCount,
        participants: [],
        damageMap: {},
        killClaimedSeq: monster.seq,
        killClaimedAt: new Date(),
        currentHp: 0,
        activeHealerAura: null,
        activeEvent: {
          id: chosenEvent.id,
          name: tpl ? tpl.name : chosenEvent.id,
          message: tpl ? tpl.message : null,
          startedAt,
          endsAt,
          pendingMonsterSeq: pendingMonster ? pendingMonster.seq : null,
          nodes: (tpl && tpl.nodes) || [],
          npc: (tpl && tpl.npc) || null
        }
      };
      await sc.monsterService.saveState(eventState, zoneKey);
      _republishPanel(sc, zoneKey, null, 0, 0, {}, eventState.activeEvent).catch((e) => console.error("[Panel] NPC event publish failed:", e?.message || e));
      _scheduleZoneEventFinalize(sc, zoneKey, endsAt);
    } else {
      const pickedMonster = chosenMonster || nextMonster;
      zoneLastChosen.set(zoneKey, { type: "monster", id: pickedMonster?.id || monster.id });
      if (pickedMonster) {
        const transitionState = {
          ...freshState,
          killCount: newKillCount
        };
        await _startMonsterTransition(sc, zoneKey, pickedMonster, transitionState, {
          sourceMonsterName: monster.name,
          sourceMonsterSeq: monster.seq
        });
      } else {
        const newState = {
          ...freshState,
          currentHp: 0,
          activeMonsterSeq: freshState.activeMonsterSeq,
          killCount: newKillCount,
          participants: [],
          damageMap: {},
          killClaimedSeq: monster.seq,
          killClaimedAt: new Date(),
          activeHealerAura: null,
          activeEvent: null,
          activeTransition: null
        };
        await sc.monsterService.saveState(newState, zoneKey);
        _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap).catch((e) => console.error("[Panel] empty state publish failed:", e?.message || e));
      }
    }
  } else {
    const matchedEvent = await sc.monsterEventService.pickEventForTransition({
      zone: zoneKey,
      defeatedMonsterSeq: monster.seq
    }).catch(() => null);
    if (matchedEvent && nextMonster) {
      const startedAt = new Date().toISOString();
      const endsAt = new Date(Date.now() + (matchedEvent.durationSec || 12) * 1000).toISOString();
      const eventState = {
        ...freshState,
        killCount: newKillCount,
        participants: [],
        damageMap: {},
        killClaimedSeq: monster.seq,
        killClaimedAt: new Date(),
        currentHp: 0,
        activeEvent: {
          id: matchedEvent.id,
          name: matchedEvent.name,
          message: matchedEvent.message,
          startedAt,
          endsAt,
          pendingMonsterSeq: nextMonster.seq,
          // 保留 nodes 與 npc 以便在面板與互動處理時使用
          nodes: matchedEvent.nodes || [],
          npc: matchedEvent.npc || null
        }
      };
      await sc.monsterService.saveState(eventState, zoneKey);
      _republishPanel(sc, zoneKey, null, 0, 0, {}, eventState.activeEvent).catch((e) => console.error("[Panel] NPC event publish failed:", e?.message || e));
      _scheduleZoneEventFinalize(sc, zoneKey, endsAt);
    } else {
      if (nextMonster) {
        const transitionState = {
          ...freshState,
          killCount: newKillCount
        };
        await _startMonsterTransition(sc, zoneKey, nextMonster, transitionState, {
          sourceMonsterName: monster.name,
          sourceMonsterSeq: monster.seq
        });
      } else {
        const newState = {
          ...freshState,
          currentHp: 0,
          activeMonsterSeq: freshState.activeMonsterSeq,
          killCount: newKillCount,
          participants: [],
          damageMap: {},
          killClaimedSeq: monster.seq,
          killClaimedAt: new Date(),
          activeEvent: null,
          activeTransition: null
        };
        await sc.monsterService.saveState(newState, zoneKey);
        _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap).catch((e) => console.error("[Panel] empty state publish failed:", e?.message || e));
      }
    }
  }

  // 通知參戰獎勵（DM）
  rewardLines.push(...buildPartyRewardSummary(perPidRewards, mergedDmg));
  _notifyKillRewards(monster.name, perPidRewards).catch((e) => console.error("[NotifyKill] top-level error:", e?.message || e));

  // 推送 SSE reward 事件給所有參戰者（web 端通知紀錄）
  try {
    const pushReward = sc._pushRewardToPlayer;
    if (typeof pushReward === "function") {
      for (const [pid, rewards] of Object.entries(perPidRewards)) {
        if (rewards?._expGrantFailed) continue;
        if (!rewards.gold && !rewards.exp && !rewards.drops?.length) continue;
        pushReward(pid, {
          monsterName: monster.name,
          gold:     rewards.gold,
          exp:      rewards.exp,
          levelUps: rewards.levelUps,
          newLevel: rewards.newLevel,
          drops:    rewards.drops,
        });
      }
    }
  } catch (_) {}

  // 回傳結構化摘要供 web API 使用
  const myReward = perPidRewards[discordId] || { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
  rewardLines._summary = {
    gold:     myReward.gold,
    exp:      myReward.exp,
    levelUps: myReward.levelUps,
    newLevel: myReward.newLevel,
    drops:    myReward.drops,
  };

  return rewardLines;
}

module.exports = { finishMonsterKill };
