"use strict";
const seasonState = require("../../services/access/seasonStateStore");
const maintenance = require("../../services/access/maintenanceStore");
const { slimInventoryEntry } = require("../../shared/inventoryStorage");
function createPartyTowerRepository({ collection }) {
  const syncedVersions = new Map();
  async function syncTelemetry(room) {
    if (!room.testTelemetry?._id) return;
    if ((syncedVersions.get(room.testTelemetry._id) || 0) >= room.version) return;
    const coll = await collection("partyTowerTestRuns");
    const evidence = { ...room.testTelemetry, roomVersion: room.version, updatedAt: new Date().toISOString() };
    // A stale room retry cannot overwrite newer committed evidence.
    await coll.updateOne({ _id: evidence._id, $or: [{ roomVersion: { $lte: room.version } }, { roomVersion: { $exists: false } }] }, { $set: evidence }, { upsert: true }).catch(e => { if(e.code !== 11000) throw e; });
    syncedVersions.set(evidence._id, Math.max(room.version, syncedVersions.get(evidence._id) || 0));
    if (syncedVersions.size > 256) syncedVersions.delete(syncedVersions.keys().next().value);
  }
  async function projectTelemetry(room) {
    try { await syncTelemetry(room); } catch(e) { console.error("[PartyTelemetry] durable room evidence pending retry", e.message); }
  }
  return {
    syncTelemetry,
    async findForPlayer(id) { return (await collection("partyTowerRooms")).findOne({ active: true, activePlayers: id }); },
    async find(id) { return (await collection("partyTowerRooms")).findOne({ _id: id }); },
    async list() { return (await collection("partyTowerRooms")).find({ active: true }).toArray(); },
    async save(room, version) {
      if (maintenance.isStrict()) throw new Error("換季鎖定中，暫停組隊");
      const coll = await collection("partyTowerRooms");
      room.activePlayers = room.active ? room.members.map(m => m.discordId) : [];
      if (version == null) { room.version = 1; await coll.insertOne(room); await projectTelemetry(room); return; }
      room.version = version + 1;
      const r = await coll.replaceOne({ _id: room._id, version }, room);
      if (!r.matchedCount) throw Object.assign(new Error("隊伍狀態已更新，請重試"), { status: 409 });
      await projectTelemetry(room);
    },
    async grantItems(playerId, entries, receipt, pending = false) {
      if (maintenance.isStrict()) throw new Error("換季鎖定中，暫停發獎");
      const coll = await collection("progress");
      const field = pending ? "partyPendingDrops" : "inventory";
      const r = await coll.updateOne({ ...seasonState.progressFilter(playerId), partyItemReceipts: { $ne: receipt } }, {
        $push: { [field]: { $each: entries.map(slimInventoryEntry) }, partyItemReceipts: receipt },
        $set: { updatedAt: new Date().toISOString() },
      });
      if (!r.matchedCount && !(await coll.findOne({ ...seasonState.progressFilter(playerId), partyItemReceipts: receipt }))) throw new Error("找不到本季人物資料，掉落尚未發放");
      require("./requestCache").clearCurrentCache();
      const { playerEventBus } = require("../../services/realtime/playerEventBus");
      playerEventBus.invalidateInventory(playerId);
    },
  };
}
module.exports = { createPartyTowerRepository };
