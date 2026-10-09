"use strict";

const { randomUUID } = require("node:crypto");
const { localRuntimeHostId, isLocalProcessDead } = require("./runtimeHost");

// One authoritative runtime per database. In-memory battle locks, SSE and rooms
// remain safe only while this ownership is exclusive. This is not cluster mode.
async function acquireRuntimeLease(db, { leaseMs = 60000, heartbeatMs = 10000,
  owner = randomUUID(), hostId = localRuntimeHostId(), pid = process.pid, onLost = () => process.exit(1) } = {}) {
  const collection = db.collection("runtimeLeases");
  const key = "game-runtime";
  const expiry = () => ({ $add: ["$$NOW", leaseMs] });
  try {
    try { await collection.insertOne({ _id: key, expiresAt: new Date(0) }, { writeConcern: { w: "majority" } }); }
    catch (error) { if (error.code !== 11000) throw error; }
    // Never release while the old runtime can still write. On this host only,
    // the OS proves it has exited; CAS then fences competing replacement boots.
    const previous = await collection.findOne({ _id: key });
    const deadLocalOwner = hostId && previous?.hostId === hostId && isLocalProcessDead(previous.pid);
    const filter = deadLocalOwner
      ? { _id: key, owner: previous.owner, hostId, pid: previous.pid }
      : { _id: key, $expr: { $lte: [{ $ifNull: ["$expiresAt", new Date(0)] }, "$$NOW"] } };
    const acquired = await collection.findOneAndUpdate(filter,
      [{ $set: { owner, hostId: { $literal: hostId }, pid, expiresAt: expiry(), updatedAt: "$$NOW" } }], {
      returnDocument: "after", writeConcern: { w: "majority" }, maxTimeMS: 5000
    });
    if (acquired?.owner !== owner) throw new Error("GAME_RUNTIME_ALREADY_RUNNING: 此資料庫已有遊戲程序，請先停止原程序。");
  } catch (error) {
    if (error.code === 11000) throw new Error("GAME_RUNTIME_ALREADY_RUNNING: 此資料庫已有遊戲程序，請先停止原程序。");
    throw error;
  }
  let stopped = false;
  let renewing = false;
  // Local monotonic deadline also detects event-loop stalls; no late lease revival.
  let deadline = performance.now() + leaseMs - heartbeatMs;
  function lose(error) {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearInterval(watchdog);
    console.error("[RuntimeLease] ownership lost; stopping runtime:", error.message);
    onLost(error);
  }
  async function renew() {
    if (stopped || renewing) return;
    if (performance.now() >= deadline) return lose(new Error("Lease heartbeat deadline exceeded"));
    renewing = true;
    try {
      const result = await collection.updateOne({ _id: key, owner,
        $expr: { $gt: ["$expiresAt", "$$NOW"] }
      }, [{ $set: { expiresAt: expiry(), updatedAt: "$$NOW" } }], {
        writeConcern: { w: "majority" }, maxTimeMS: 5000
      });
      if (result.matchedCount !== 1) throw new Error("Runtime lease owner changed or expired");
      deadline = performance.now() + leaseMs - heartbeatMs;
    } catch (error) { lose(error); }
    finally { renewing = false; }
  }
  const timer = setInterval(renew, heartbeatMs);
  const watchdog = setInterval(() => {
    if (performance.now() >= deadline) lose(new Error("Runtime lease deadline exceeded"));
  }, Math.min(heartbeatMs, 1000));
  timer.unref?.(); watchdog.unref?.();
  return {
    owner,
    assertOwned() {
      if (stopped || performance.now() >= deadline) throw new Error("GAME_RUNTIME_LEASE_LOST");
    },
    async release() {
      stopped = true;
      clearInterval(timer); clearInterval(watchdog);
      // Caller must drain writes and stop scheduled work BEFORE releasing.
      await collection.deleteOne({ _id: key, owner }, { writeConcern: { w: "majority" } });
    }
  };
}

module.exports = { acquireRuntimeLease };
