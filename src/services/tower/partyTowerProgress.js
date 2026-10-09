"use strict";
const { withPlayerProgressLock } = require("../progress/progressLocks");
const badges = require("../../shared/jobBadgeLevel");
const { bestiaryGainFromDamage } = require("../../shared/bestiary");
const { QUEST_CADENCES, resolvePeriodKey } = require("../weeklyQuest/weeklyQuestService");
const { resolveWeaponQuestMetric, resolveJobBattleMetric, isSupportJobBadge } = require("../battle/battleQuestProgress");
function killRecord(room, member, monster, result, time) {
  const damage = Number(result.memberDamage?.find(row => row.discordId === member.discordId)?.damageDealt || 0);
  const maxHp = room.monsterPreview?.hp || require("../../shared/partyTowerRules").scaleMonster(monster, room.difficulty).calc.maxHp;
  const metrics = { battle_count: 1, battle_win: 1, party_floor_clear: 1, damage_total: damage };
  const stats = result.memberDamage?.find(row => row.discordId === member.discordId)?.questStats || {};
  for (const [metric, field] of Object.entries({ damage_taken: "damageTaken", heal_done: "healDone", lifesteal_done: "lifestealDone", combo_count: "comboCount", dodge_count: "dodgeCount", block_count: "blockCount", stun_count: "stunCount", burn_trigger_count: "burnTriggerCount" })) {
    if (Number(stats[field]) > 0) metrics[metric] = Number(stats[field]);
  }
  for (const type of [resolveWeaponQuestMetric(member.stats.weaponType), resolveJobBattleMetric(member.equipped?.job_eq), isSupportJobBadge(member.equipped?.job_eq) ? "battle_with_support_job" : null]) {
    if (type) metrics[type] = (metrics[type] || 0) + 1;
  }
  return { floor: room.clearedFloor, monsterId: String(monster.id || monster._id || monster.name),
    gain: bestiaryGainFromDamage(damage, maxHp), metrics, titleEligible: require("../../shared/autumnTitleRules").isPublicSeasonOpen(),
    periodKeys: Object.fromEntries(QUEST_CADENCES.map(c => [c, resolvePeriodKey(c)])), recordedAt: new Date(time).toISOString() };
}
async function settleProgress(sc, room, member, reward, time) {
  const kills = reward.progressKills || [];
  if (!kills.length) return; // Older rooms have no persisted kill evidence; never invent it.
  const receipt = `${room.runId}:${member.discordId}`;
  const current = await sc.progressRepository.findByPlayerId(member.discordId);
  if (!current || Number(current.activeCharacterSlot || 1) !== Number(member.progressSnapshot?.activeCharacterSlot || 1)) throw new Error("人物已切換，副本養成等待恢復");
  const quests = sc.questService || sc.weeklyQuestService;
  if (quests) {
    const groups = new Map();
    for (const kill of kills) {
      const key = JSON.stringify([kill.periodKeys, kill.titleEligible === true]);
      if (!groups.has(key)) groups.set(key, { periodKeys: kill.periodKeys, titleEligible: kill.titleEligible === true, metrics: {} });
      const group = groups.get(key);
      for (const [type, amount] of Object.entries(kill.metrics)) group.metrics[type] = (group.metrics[type] || 0) + amount;
    }
    for (const [key, group] of groups) await quests.recordProgressBatch(member.discordId, group.metrics,
      { periodKeys: group.periodKeys, operationId: `${receipt}:${key}`,
        autumnEvent: { eligible: group.titleEligible, slot: member.progressSnapshot?.activeCharacterSlot || 1, seasonKey: room.seasonKey } });
    const clearRule = require("../../shared/partyTowerRewardRules").REWARDS[room.difficulty];
    if (room.terminal === "win" && !room.failReason && clearRule && room.clearedFloor === clearRule.floors && kills.some(k => k.floor === clearRule.floors))
      await quests.recordProgressBatch(member.discordId, { [clearRule.metric]: 1 },
        { periodKeys: kills.at(-1).periodKeys, operationId: `tower-first-clear:${receipt}` });
    if (room.terminal === "win" && room.difficulty === "challenge" && room.clearedFloor === 50 && kills.at(-1)?.titleEligible === true)
      await quests.autumnTitles?.record(member.discordId, { type: "challenge", difficulty: "challenge", floor: 50, runId: room.runId,
        slot: member.progressSnapshot?.activeCharacterSlot || 1, seasonKey: room.seasonKey, id: `challenge:${receipt}` });
  }
  if (sc.passService?.addPointsOnce) await sc.passService.addPointsOnce(member.discordId, kills.length * 5, `party:${receipt}`);
  await withPlayerProgressLock(member.discordId, async () => {
    for (let retry = 0; retry < 8; retry++) {
      const p = await sc.progressRepository.findByPlayerId(member.discordId);
      if (!p) throw new Error("找不到副本人物資料");
      if ((p.partyProgressReceipts || []).includes(receipt)) return;
      if (Number(p.activeCharacterSlot || 1) !== Number(member.progressSnapshot?.activeCharacterSlot || 1)) throw new Error("人物已切換，副本養成等待恢復");
      const next = structuredClone(p);
      next.bestiary ||= {};
      for (const kill of kills) next.bestiary[kill.monsterId] = Number(next.bestiary[kill.monsterId] || 0) + kill.gain;
      const original = member.equipped?.job_eq;
      const badge = next.equipment?.job_eq;
      if (badges.isJobBadgeEntry(original)) {
        if (!badge || (original.uuid ? badge.uuid !== original.uuid : (badge.itemId || badge.id) !== (original.itemId || original.id))) throw new Error("職業徽章已變更，副本熟練等待恢復");
        badges.gainBattleExp(badge, kills.length);
      }
      next.partyProgressReceipts = [...(p.partyProgressReceipts || []), receipt];
      next.updatedAt = new Date(Math.max(time, (Date.parse(p.updatedAt) || 0) + 1)).toISOString();
      if (await sc.progressRepository.saveIfUnchanged(next, p.updatedAt)) {
        require("../realtime/playerEventBus").playerEventBus.invalidateInventory(member.discordId);
        return;
      }
    }
    throw new Error("副本養成儲存忙碌，請重試");
  });
}
module.exports = { killRecord, settleProgress };
