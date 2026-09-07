"use strict";

const { GOLD_POOL_RULE_BY_ZONE } = require("./zoneBattleState");

const { GEM_TIER_ORDER } = require("./zoneBattleState");
const { ZONE_PARTICIPATION_GEM_TIER } = require("./zoneBattleState");

const { isEffectConditionMet, collectEquipmentEffects, mergeEquippedFromLibrary, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");
const { getEquipmentTierSetBonuses } = require("../../shared/equipmentTierSetBonuses");
const { getDropBoostPct } = require("../../shared/pkArenaConfig");
const { RARE_TIERS } = require("./zoneBattleState");

function getDynamicGoldPoolFloor(zoneKey, participantCount) {
  const zoneRule = GOLD_POOL_RULE_BY_ZONE[zoneKey];
  if (!zoneRule) return 0;
  const minPerPlayer = Number(zoneRule.minPerPlayer || 0);
  if (minPerPlayer <= 0) return 0;
  return Math.round(Math.max(1, participantCount) * minPerPlayer);
}

function getNextEnhanceGemTier(tier) {
  const normalized = String(tier || "").toUpperCase();
  const idx = GEM_TIER_ORDER.indexOf(normalized);
  if (idx < 0 || idx >= GEM_TIER_ORDER.length - 1) return null;
  return GEM_TIER_ORDER[idx + 1];
}

function getParticipationGemTiers(zoneKey, monster) {
  const baseTier = ZONE_PARTICIPATION_GEM_TIER[zoneKey] || "D";
  const tiers = [baseTier];
  if (monster?.isBoss) {
    const nextTier = getNextEnhanceGemTier(baseTier);
    if (nextTier) tiers.push(nextTier);
  }
  return tiers;
}

function isMonsterCardItem(item) {
  return !!(
    item &&
    (
      item.equipSlot === "special" ||
      item.slotType === "special_1" ||
      item.monsterCardOf ||
      item.monsterCardSkill
    )
  );
}

async function buildMonsterDropPool(sc, monster) {
  const pool = Array.isArray(monster?.drops) ? [...monster.drops] : [];
  const cardItemId = monster?.equipment?.special_1?.itemId || monster?.equipment?.special_1?.id || null;
  if (!cardItemId) return pool;

  const card = await sc.itemRepository.findById(cardItemId).catch(() => null);
  if (!card || !isMonsterCardItem(card)) return pool;

  const existingCardDropIndex = pool.findIndex((drop) => drop?.itemId === cardItemId);
  if (existingCardDropIndex >= 0) {
    // 卡片已列在掉落表 → 掉率統一寫死 1%（覆蓋 DB 值），補上來源標記
    pool[existingCardDropIndex] = {
      ...pool[existingCardDropIndex],
      chance: 1,
      source: pool[existingCardDropIndex].source || "monster_card"
    };
    return pool;
  }

  // 掉落表沒列到卡片 → 補一個 1% 保底，讓卡片可掉出
  pool.push({
    itemId: card.id,
    chance: 1,
    source: "monster_card"
  });
  return pool;
}

function tryStackGem(progress, gemItemId) {
  if (!gemItemId || !Array.isArray(progress?.inventory)) return false;

  // 查找背包中相同 itemId 的寶石
  const existingGem = progress.inventory.find(i => i?.itemId === gemItemId);
  if (existingGem) {
    // 初始化 stackCount 如果還沒有
    if (!existingGem.stackCount) existingGem.stackCount = 1;
    existingGem.stackCount += 1;
    return true;
  }
  return false;
}

function toPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num;
}

function toMultiplier(percent) {
  return Math.max(0, 1 + percent / 100);
}

function collectRewardEffectRefs(progress) {
  const refs = [];
  const equipped = progress?.equipment || {};
  const effectContext = {
    equipped,
    inventory: Array.isArray(progress?.inventory) ? progress.inventory : []
  };
  for (const entry of Object.values(equipped)) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.passiveEffects)) refs.push(...entry.passiveEffects);
    if (Array.isArray(entry.combatEffects)) refs.push(...entry.combatEffects);
  }
  if (Array.isArray(progress?.activeEffects)) refs.push(...progress.activeEffects);
  return refs.filter((effect) => (
    effect &&
    typeof effect === "object" &&
    effect.key &&
    isEffectConditionMet(effect, effectContext)
  ));
}

function buildRewardModifiers(progress, partyRefs = []) {
  const refs = [
    ...collectRewardEffectRefs(progress),
    ...(Array.isArray(partyRefs) ? partyRefs : [])
  ];
  const tierSetBonuses = getEquipmentTierSetBonuses(progress?.equipment || {});
  const luk = Number(progress?.attributes?.luk ?? 0);
  let expPct = 0;
  let goldPct = 0;
  let dropPct = luk * 0.1;  // LUK 每點 +0.1% 掉落率
  let rareDropPct = 0;

  for (const effect of refs) {
    const value = toPct(effect?.params?.value ?? effect?.value ?? 0);
    switch (effect.key) {
      case "exp_gain_up":
        expPct += value;
        break;
      case "gold_gain_up":
        goldPct += value;
        break;
      case "drop_rate_up":
        dropPct += value;
        break;
      case "rare_drop_rate_up":
        rareDropPct += value;
        break;
      case "monster_reward_up":
        expPct += value;
        goldPct += value;
        dropPct += value;
        break;
      case "party_exp_gain_up":
        expPct += value;
        break;
      case "party_gold_gain_up":
        goldPct += value;
        break;
      default:
        break;
    }
  }

  expPct += tierSetBonuses.expPct;
  goldPct += tierSetBonuses.goldPct;
  dropPct += tierSetBonuses.dropPct;
  dropPct += getDropBoostPct(Number(progress?.pkRating ?? 0));

  // 全服 Buff（直播連動事件）：疊加到個人加成上。
  // 此處是所有戰鬥獎勵的共用 chokepoint（Discord 打怪 / 網頁 quick-battle / 世界王都經過），
  // 且回傳的 dropPct 會被 calculateFinalDropChance 使用，故金幣/經驗/掉寶一次覆蓋。
  try {
    const gb = require("../../services/stream/globalBuffService").getActiveModifiers();
    expPct += gb.expPct;
    goldPct += gb.goldPct;
    dropPct += gb.dropPct;
  } catch (_) { /* buff 服務未就緒不影響結算 */ }

  return {
    expPct,
    goldPct,
    dropPct,
    rareDropPct,
    expMultiplier: toMultiplier(expPct),
    goldMultiplier: toMultiplier(goldPct),
    dropMultiplier: toMultiplier(dropPct),
    rareDropMultiplier: toMultiplier(rareDropPct)
  };
}

function calculateFinalDropChance(baseChance, rewardMod = {}, item = null) {
  const base = Math.min(100, Math.max(0, Number(baseChance) || 0));
  if (base <= 0) return 0;

  const tier = String(item?.tier || "").toUpperCase();
  const isRare = RARE_TIERS.has(tier);
  const bonusPct = (Number(rewardMod.dropPct) || 0) + (isRare ? (Number(rewardMod.rareDropPct) || 0) : 0);
  return Math.min(100, Math.max(0, base * toMultiplier(bonusPct)));
}
module.exports = { getDynamicGoldPoolFloor, getNextEnhanceGemTier, getParticipationGemTiers, isMonsterCardItem, buildMonsterDropPool, tryStackGem, toPct, toMultiplier, collectRewardEffectRefs, buildRewardModifiers, calculateFinalDropChance };
