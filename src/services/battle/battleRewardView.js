"use strict";

const { buildItemEffectLines } = require("../../shared/itemEffectLines");

function toWebDrop(o) {
  if (!o) return null;
  return {
    uuid: o.uuid,
    itemId: o.itemId,
    name: o.itemName,
    image: o.imageThumbnailUrl || o.imageUrl || null,
    imageUrl: o.imageUrl || null,
    tier: o.tier || null,
    itemType: o.itemType || null,
    equipSlot: o.equipSlot || null,
    equipStats: o.equipStats || {},
    weaponType: o.weaponType || null,
    isTwoHanded: !!o.isTwoHanded,
    effect: o.itemEffect || null,
    useEffects: o.useEffects || [],
    passiveEffects: o.passiveEffects || [],
    procEffects: o.procEffects || [],
    combatEffects: o.combatEffects || [],
    monsterCardSkill: o.monsterCardSkill || null,
    // 卡片技能 + 裝備特效的中文說明列（給網頁掉落氣泡詳細視窗顯示，與背包同格式）
    effectLines: buildItemEffectLines(o),
    source: o.source || "monster_drop",
    sourceRef: o.sourceRef || null,
  };
}

function buildPartyRewardSummary(perPidRewards = {}, damageMap = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 12);
  const entries = Object.entries(perPidRewards)
    .filter(([, rewards]) => rewards && (rewards.gold > 0 || rewards.exp > 0 || rewards.drops?.length || rewards._expGrantFailed))
    .sort((a, b) => {
      const dmgA = Number(damageMap?.[a[0]]?.damage || 0);
      const dmgB = Number(damageMap?.[b[0]]?.damage || 0);
      return dmgB - dmgA;
    });

  if (!entries.length) return [];

  const lines = entries.slice(0, limit).map(([pid, rewards]) => {
    const name = damageMap?.[pid]?.name || pid;
    const parts = [];
    if (rewards.gold > 0) parts.push(`金幣 +${rewards.gold}`);
    if (rewards._expGrantFailed) parts.push("EXP 未寫入");
    else if (rewards.exp > 0) parts.push(`EXP +${rewards.exp}`);
    if (rewards.levelUps > 0) parts.push(`升級到 Lv.${rewards.newLevel}`);
    if (Array.isArray(rewards.drops) && rewards.drops.length > 0) {
      parts.push(`道具 ${rewards.drops.join("、")}`);
    }
    return `・${name}：${parts.join("、") || "無獎勵"}`;
  });

  if (entries.length > limit) {
    lines.push(`・其餘 ${entries.length - limit} 人略`);
  }
  return ["👥 **全體參戰獎勵**", ...lines];
}
module.exports = { toWebDrop, buildPartyRewardSummary };
