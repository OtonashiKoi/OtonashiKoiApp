"use strict";
async function claimPending({ sc, options, now, id }) {
  const { withPlayerProgressLock } = require("../progress/progressLocks");
  const error = (message, status) => Object.assign(new Error(message), { status });
  return withPlayerProgressLock(id, async () => {
    for (let retry = 0; retry < 8; retry++) {
      const p = await sc.progressRepository.findByPlayerId(id);
      if (!p) throw error("找不到人物資料", 404);
      const bp = require("../backpack/backpackService");
      const capacity = options.capacity ? await options.capacity(id) : (await bp.resolveEffectiveCapacity(id)).cap;
      let free = capacity - (p.inventory || []).filter(bp.countsTowardCapacity).length;
      const picked = [], waiting = [];
      for (const entry of p.partyPendingDrops || []) {
        if (!bp.countsTowardCapacity(entry) || free > 0) { picked.push(entry); if (bp.countsTowardCapacity(entry)) free--; }
        else waiting.push(entry);
      }
      if (!picked.length) return { claimed: 0, pending: waiting.length };
      const next = { ...p, inventory: [...(p.inventory || []), ...picked], partyPendingDrops: waiting, updatedAt: new Date(now()).toISOString() };
      if (await sc.progressRepository.saveIfUnchanged(next, p.updatedAt)) {
        require("../realtime/playerEventBus").playerEventBus.invalidateInventory(id);
        return { claimed: picked.length, pending: waiting.length };
      }
    }
    throw error("背包忙碌，請重試", 409);
  });
}
module.exports = { claimPending };
