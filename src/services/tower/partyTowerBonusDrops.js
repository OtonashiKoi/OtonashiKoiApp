"use strict";
const { randomUUID } = require("crypto");
const { checkpoint } = require("../../shared/partyTowerRewardRules");
const { slimInventoryEntry } = require("../../shared/inventoryStorage");
async function addCheckpointDrops(sc, room, now, random = Math.random) {
  if (room.clearedFloor % 5) return;
  const definitions = new Map();
  for (const spec of checkpoint(room.difficulty, room.clearedFloor, () => 0)) {
    const item = await sc.itemRepository.findById(spec.itemId);
    if (!item || item.itemType !== "consumable") throw Error("爬塔強化石資料不存在，請重試結算");
    definitions.set(spec.itemId, item);
  }
  for (const member of room.members) {
    const reward = room.rewards[member.discordId];
    if ((reward.stoneCheckpoints || []).includes(room.clearedFloor)) continue;
    for (const spec of checkpoint(room.difficulty, room.clearedFloor, random)) {
      const existing = reward.drops.find(e => e.itemId === spec.itemId && e.source === "party_tower_checkpoint");
      if (existing) existing.stackCount += spec.qty;
      else {
        const item = definitions.get(spec.itemId);
        reward.drops.push(slimInventoryEntry({ ...item, _id: undefined, uuid: randomUUID(), itemId: item.id, itemName: item.name,
          itemEffect: item.effect, stackCount: spec.qty, source: "party_tower_checkpoint", sourceRef: room.runId,
          obtainedAt: new Date(now).toISOString() }));
      }
    }
    (reward.stoneCheckpoints ||= []).push(room.clearedFloor);
  }
}
module.exports = { addCheckpointDrops };
