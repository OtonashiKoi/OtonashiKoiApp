"use strict";

const getServiceContext = (...args) => require("./getBattleContext").getServiceContext(...args);
const isWorldBossAllPartsDefeated = (...args) => require("./bossMechanics").isWorldBossAllPartsDefeated(...args);
const recordQuestForPlayersInBackground = (...args) => require("./battleQuestProgress").recordQuestForPlayersInBackground(...args);
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");
const { killInProgress } = require("./zoneBattleState");

async function handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage = 0, zoneKey = "normal", serviceContext = null }) {
  const sc = serviceContext || getServiceContext();
  const rewardLines = [];

  // 擊敗古龍王(B)（dragon_king_lair 世界王全破）→ 記錄屠龍任務進度
  // 有參與就算一隻：所有參戰者(含補刀者)各 +1，不是只記最後補刀的人
  if (zoneKey === "dragon_king_lair" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    // 參與者 = 對本王造成過傷害的人(damageMap) + 排隊參戰名單 + 補刀者
    const slayers = [...new Set([
      ...(state?.damageMap ? Object.keys(state.damageMap) : []),
      ...(Array.isArray(state?.participants) ? state.participants : []),
      discordId,
    ].filter(Boolean))];
    recordQuestForPlayersInBackground(sc?.questService || sc?.weeklyQuestService, slayers, "kill_dragon_king", 1);
  }

  // 擊敗大史王（elite 世界王全破）→ 記錄屠史任務進度（比照古龍王：所有參戰者各 +1）
  if (zoneKey === "elite" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    const slayers = [...new Set([
      ...(state?.damageMap ? Object.keys(state.damageMap) : []),
      ...(Array.isArray(state?.participants) ? state.participants : []),
      discordId,
    ].filter(Boolean))];
    recordQuestForPlayersInBackground(sc?.questService || sc?.weeklyQuestService, slayers, "kill_slime_king", 1);
  }

  // 擊敗地獄狼牙王（hellfire_depths 世界王全破）→ 記錄屠狼任務進度（比照古龍王：所有參戰者各 +1）
  if (zoneKey === "hellfire_depths" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    const slayers = [...new Set([
      ...(state?.damageMap ? Object.keys(state.damageMap) : []),
      ...(Array.isArray(state?.participants) ? state.participants : []),
      discordId,
    ].filter(Boolean))];
    recordQuestForPlayersInBackground(sc?.questService || sc?.weeklyQuestService, slayers, "kill_hellfang_king", 1);
  }

  // 擊敗島島龜王（event_boss 世界王全破）→ 記錄屠龜任務進度（比照古龍王：所有參戰者各 +1）
  // ⚠️ 四隻世界王都要有掛鉤，否則「夏季四天王」那條複合任務永遠差一角。
  if (zoneKey === "event_boss" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    const slayers = [...new Set([
      ...(state?.damageMap ? Object.keys(state.damageMap) : []),
      ...(Array.isArray(state?.participants) ? state.participants : []),
      discordId,
    ].filter(Boolean))];
    recordQuestForPlayersInBackground(sc?.questService || sc?.weeklyQuestService, slayers, "kill_island_turtle", 1);
  }

  if (isWorldBossZone(zoneKey) && monster?.isBoss && !isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    rewardLines.push("目前僅擊破單一部位，世界王需所有部位全破才會結算。");
    return rewardLines;
  }

  // ── 並發雙殺防護：同一隻怪只允許一次結算 ──
  const killKey = `${zoneKey}:${monster.seq}`;
  try {
    if (killInProgress.has(killKey)) {
      // 另一位玩家已在結算中，此次擊殺視為無效，不重複發獎
      return rewardLines;
    }
    killInProgress.add(killKey);
  } catch (e) {
    return rewardLines;
  }

  try {
  // DB 層原子收付擊殺權（防止 PM2 雙進程重載期間雙重結算）
  const claimed = await sc.monsterRepository.claimKill(zoneKey, monster.seq);
  if (!claimed) {
    return rewardLines;
  }

  const { healerBonusPids, perPidRewards, participants, rewardModsByPid, mergedDmg, canSendRewardNotice, progressCache } = await require("./grantKillCurrencyAndExp").grantKillCurrencyAndExp({ state, discordId, zoneKey, monster, sc, displayName, totalDamage, session, rewardLines });
  await require("./grantKillDrops").grantKillDrops({ healerBonusPids, perPidRewards, monster, discordId, rewardLines, sc, participants, rewardModsByPid, zoneKey, displayName, mergedDmg, canSendRewardNotice, progressCache });
  return await require("./finishMonsterKill").finishMonsterKill({ state, monster, sc, zoneKey, mergedDmg, perPidRewards, rewardLines, discordId });
  } finally {
    killInProgress.delete(killKey);
  }
}

module.exports = { handleMonsterKill };
