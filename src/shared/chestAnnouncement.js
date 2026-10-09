"use strict";

function isChestCard(entry) {
  return Boolean(entry && (
    entry.itemType === "monster_card" || entry.monsterCardOf || entry.monsterCardSkill ||
    entry.isNpcCard || entry.npcCardOf || /^special_/.test(String(entry.equipSlot || ""))
  ));
}

function currentlyOwnedItemIds(progress) {
  const ids = (progress?.inventory || []).map((entry) => entry?.itemId).filter(Boolean);
  const equipmentSets = [progress?.equipment, ...Object.values(progress?.characterSlots || {}).map((slot) => slot?.equipment)];
  for (const equipment of equipmentSets) ids.push(...Object.values(equipment || {}).map((entry) => entry?.itemId).filter(Boolean));
  return ids;
}

function hasObtainedChestItem(progress, itemId) {
  return Boolean(itemId && ((progress?.chestAnnouncementKnownItemIds || []).includes(itemId)
    || currentlyOwnedItemIds(progress).includes(itemId)));
}

function recordChestItem(next, progress, itemId) {
  const known = new Set([...(progress?.chestAnnouncementKnownItemIds || []), ...currentlyOwnedItemIds(progress)]);
  if (itemId) known.add(itemId);
  next.chestAnnouncementKnownItemIds = [...known];
}

module.exports = { isChestCard, hasObtainedChestItem, recordChestItem };
