'use strict';
const { AppError } = require('../../shared/errors');

// Active character slots and equipment presets are snapshots, not extra owned items.
function ownedEntries(progress) {
  const entries = [...(progress?.inventory || []), ...Object.values(progress?.equipment || {})];
  const active = String(progress?.activeCharacterSlot || 1);
  for (const [slot, character] of Object.entries(progress?.characterSlots || {})) {
    if (String(slot) !== active) entries.push(...Object.values(character?.equipment || {}));
  }
  return entries.filter(e => e?.uuid);
}

function lockSnapshot(progress) {
  return Object.fromEntries(ownedEntries(progress).map(e => [String(e.uuid), Boolean(e.locked)]));
}

function reconcileEquipmentLocks(next, current, baseline) {
  // Keep the DB snapshot immutable: it is also used as the exact CAS guard.
  const copyEquipment = equipment => equipment && Object.fromEntries(
    Object.entries(equipment).map(([slot, entry]) => [slot, entry && { ...entry }])
  );
  next = {
    ...next,
    inventory: next.inventory?.map(entry => entry && { ...entry }),
    equipment: copyEquipment(next.equipment),
    characterSlots: next.characterSlots && Object.fromEntries(
      Object.entries(next.characterSlots).map(([slot, character]) => [slot, character && {
        ...character, equipment: copyEquipment(character.equipment)
      }])
    )
  };
  const currentLocks = lockSnapshot(current);
  const nextEntries = ownedEntries(next);
  const nextIds = new Set(nextEntries.map(e => String(e.uuid)));
  for (const [uuid, locked] of Object.entries(currentLocks)) {
    // A newer lock invalidates destruction computed from an unlocked snapshot.
    // Throw before saving any part of the mutation (including dismantle rewards).
    if (locked && !nextIds.has(uuid) && baseline?.[uuid] !== true) {
      throw new AppError('INVENTORY_LOCK_CONFLICT', '裝備鎖定狀態已更新，請重新整理後再操作', 409);
    }
  }
  for (const entry of nextEntries) {
    const uuid = String(entry.uuid);
    if (!Object.hasOwn(currentLocks, uuid)) continue;
    // Only a change relative to the read baseline represents an explicit toggle.
    // A serialized snapshot has no baseline: keep the current stored lock.
    if (!baseline || !Object.hasOwn(baseline, uuid) || Boolean(entry.locked) === baseline[uuid]) {
      entry.locked = currentLocks[uuid];
    }
  }
  return next;
}

module.exports = { lockSnapshot, reconcileEquipmentLocks };
