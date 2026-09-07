"use strict";

const { SUPPORT_JOB_KEYS } = require("./zoneBattleState");

function recordQuestForPlayersInBackground(questService, playerIds, type, amount = 1) {
  if (!questService || typeof questService.recordProgress !== "function") return;
  const ids = [...new Set((playerIds || []).map(String).filter(Boolean))];
  setImmediate(() => {
    void Promise.allSettled(ids.map((playerId) => (
      typeof questService.recordProgressBatch === "function"
        ? questService.recordProgressBatch(playerId, { [type]: amount })
        : questService.recordProgress(playerId, type, amount)
    ))).then((results) => {
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        console.error(`[Quest] background ${type} failed for ${failed.length}/${ids.length} player(s)`);
      }
    });
  });
}

async function recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats = null, weaponType = null, zoneKey = null, jobEq = null, damageTaken = 0, healDone = 0, lifestealDone = 0) {
  // 通行證點數：打怪(非落敗)依地圖階級加點
  if (outcome !== "lose" && sc?.passService?.addPointsForKill) {
    const PASS_TIER = { beginner: "D", normal: "D", mid: "C", ancient_city: "B", ancient_city_deep: "A", dragon_realm: "A", hellfire: "A", elite: "A", event_1: "A", dragon_king_lair: "S", hellfire_depths: "S" };
    sc.passService.addPointsForKill(discordId, PASS_TIER[zoneKey] || "D").catch(() => {});
  }
  const questService = sc?.questService || sc?.weeklyQuestService;
  if (!questService || typeof questService.recordProgress !== "function") return;

  const metrics = {};
  const addMetric = (type, amount = 1) => {
    const inc = Math.max(0, Number(amount) || 0);
    if (type && inc) metrics[type] = Number(metrics[type] || 0) + inc;
  };
  addMetric("battle_count", 1);
  addMetric("damage_total", totalDamage);
  // 錨點隱藏任務指標：承受傷害(沒苦硬吃)、回血量(聖人)
  addMetric("damage_taken", Math.round(Number(damageTaken || 0)));
  addMetric("heal_done", Math.round(Number(healDone || 0)));
  addMetric("lifesteal_done", Math.round(Number(lifestealDone || 0)));
  const weaponMetric = resolveWeaponQuestMetric(weaponType);
  addMetric(weaponMetric, 1);
  // 用輔助職業(徽章)出戰 → 記錄一場（供隱藏賽季任務「共鳴之鏈」用）
  if (isSupportJobBadge(jobEq)) addMetric("battle_with_support_job", 1);
  // 二轉試煉：以該一轉職業出戰一場
  {
    const _jobMetric = resolveJobBattleMetric(jobEq);
    addMetric(_jobMetric, 1);
  }
  if (outcome === "lose") addMetric("death_count", 1);
  if (combatStats) {
    addMetric("combo_count", combatStats.comboCount);
    addMetric("dodge_count", combatStats.dodgeCount);
    addMetric("block_count", combatStats.blockCount);
    addMetric("stun_count", combatStats.stunCount);
    addMetric("burn_trigger_count", combatStats.burnTriggerCount);
  }
  if (typeof questService.recordProgressBatch === "function") {
    await questService.recordProgressBatch(discordId, metrics);
  } else {
    for (const [type, amount] of Object.entries(metrics)) {
      await questService.recordProgress(discordId, type, amount);
    }
  }
  // 職業徽章熟練度 +1（裝備中的徽章才累積）。
  // 練滿 Lv20 **不廣播**——它只是讓職業任務亮起來；真正值得全服知道的是「轉職成功」。
  try {
    await sc?.jobBadgeService?.grantBattleProficiency(discordId, 1);
  } catch (error) {
    console.error(`[JobBadge] Discord battle proficiency failed | player=${discordId} | err=${error?.message || error}`);
    /* 熟練度失敗不影響戰鬥結算 */
  }
}

function resolveWeaponQuestMetric(weaponType = "") {
  const wt = String(weaponType || "");
  if (wt === "sword_1h" || wt === "sword_2h") return "battle_with_sword";
  if (wt === "axe_1h" || wt === "axe_2h") return "battle_with_axe";
  if (wt === "mace_1h" || wt === "mace_2h") return "battle_with_mace";
  if (wt === "dagger") return "battle_with_dagger";
  if (wt === "staff_1h" || wt === "staff_2h") return "battle_with_staff";
  if (wt === "bow") return "battle_with_bow";
  if (wt === "dice") return "battle_with_dice";
  return null;
}

function resolveJobBattleMetric(jobEq) {
  if (!jobEq) return null;
  try {
    const ja = require("../../shared/jobAdvancement");
    const id = String(jobEq.itemId || jobEq.id || "");
    const baseKey = ja.getBaseKeyByBadgeId(id);
    return baseKey ? ja.battleMetricFor(baseKey) : null;
  } catch (_) { return null; }
}

function isSupportJobBadge(jobEq) {
  if (!jobEq) return false;
  try {
    const { getSupportJobKey } = require("../../shared/supportAuraScaling");
    const key = getSupportJobKey({ jobKey: jobEq.itemId || jobEq.id, jobName: jobEq.itemName || jobEq.name });
    return SUPPORT_JOB_KEYS.has(key);
  } catch (_) { return false; }
}
module.exports = { recordQuestForPlayersInBackground, recordQuestBattleProgress, resolveWeaponQuestMetric, resolveJobBattleMetric, isSupportJobBadge };
