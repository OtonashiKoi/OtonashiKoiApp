"use strict";
/**
 * 領取職業徽章時，附送對應職業的 C 階武器。
 * 用 itemName 比對徽章 → 對應武器名稱，再從 itemRepository 查 ID 發放。
 *
 * 對應表（職業 → C 階武器名稱）：
 *   劍士     → 鐵製單手劍
 *   戰士     → 鐵製雙手斧
 *   矮人戰士 → 鐵製雙手槌
 *   盜賊     → 鐵製匕首
 *   弓箭手   → 鐵製弓
 *   法師     → 鐵製雙手法杖
 *   治療師   → 鐵製單手法杖
 *   軍師     → 鐵製單手劍
 *   詩人     → 鐵製弓
 *   結界師   → 鐵製雙手法杖
 */

const crypto = require("crypto");

const BADGE_TO_WEAPON_NAME = {
  "劍士徽章":     "鐵製單手劍",
  "戰士徽章":     "鐵製雙手斧",
  "矮人戰士徽章": "鐵製雙手槌",
  "盜賊徽章":     "鐵製匕首",
  "弓箭手徽章":   "鐵製弓",
  "法師徽章":     "鐵製雙手法杖",
  "治療師徽章":   "鐵製單手法杖",
  "軍師徽章":     "鐵製單手劍",
  "詩人徽章":     "鐵製弓",
  "結界師徽章":   "鐵製雙手法杖",
};

/**
 * 給定剛發出去的徽章物件，回傳對應 C 階武器名稱（找不到回 null）
 */
function getBonusWeaponNameForBadge(badge) {
  if (!badge) return null;
  // 只在實際是職業徽章類型時觸發
  if (badge.itemType !== "job_badge" && badge.equipSlot !== "job_eq") return null;
  const name = badge.itemName || badge.name || "";
  return BADGE_TO_WEAPON_NAME[name] || null;
}

/**
 * 把指定 C 階武器 push 到玩家 inventory（不會自動儲存 prog）。
 * 回傳發放的武器物件（找不到時 null）
 */
async function pushBonusWeaponToInventory({ progress, itemRepository, badge, source = "quest_job_badge_bonus" }) {
  if (!progress || !itemRepository) return null;
  const weaponName = getBonusWeaponNameForBadge(badge);
  if (!weaponName) return null;

  // 從 itemRepository 找對應 C 階武器
  const all = await itemRepository.findAll().catch(() => []);
  const weapon = all.find((it) => it && it.name === weaponName && it.tier === "C" && it.equipSlot === "weapon");
  if (!weapon) {
    console.warn(`[jobBadgeBonus] 找不到武器 ${weaponName}（C 階）`);
    return null;
  }

  if (!Array.isArray(progress.inventory)) progress.inventory = [];
  progress.inventory.push({
    uuid: crypto.randomUUID(),
    itemId: weapon.id,
    itemName: weapon.name,
    itemEffect: weapon.effect || { type: "none", value: 0 },
    useEffects: weapon.useEffects || [],
    passiveEffects: weapon.passiveEffects || [],
    procEffects: weapon.procEffects || [],
    combatEffects: weapon.combatEffects || [],
    itemType: weapon.itemType || "equipment",
    imageUrl: weapon.imageUrl || null,
    imageThumbnailUrl: weapon.imageThumbnailUrl || null,
    equipSlot: weapon.equipSlot || "weapon",
    equipStats: weapon.equipStats || null,
    weaponType: weapon.weaponType || null,
    isTwoHanded: weapon.isTwoHanded || false,
    tier: weapon.tier || "C",
    source,
    obtainedAt: new Date().toISOString(),
  });
  return weapon;
}

module.exports = {
  BADGE_TO_WEAPON_NAME,
  getBonusWeaponNameForBadge,
  pushBonusWeaponToInventory,
};
