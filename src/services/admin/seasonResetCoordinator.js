"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const maintenance = require("../access/maintenanceStore");
const seasonState = require("../access/seasonStateStore");
const webPresence = require("../realtime/webPresence");
const { makeSeasonKey, listAllPlayerIds, seasonResetAllPlayers, writeFullSeasonBackup } = require("./seasonResetService");
const { createSeasonResetBackupWriter } = require("./seasonResetBackupWriter");
const { validateSeasonReset } = require("./seasonResetValidationService");

const RUNS = "seasonResetRuns";
const CHECKPOINTS = "seasonResetRunPlayers";
const LOCKS = "seasonResetLocks";
const LOCK_ID = "global";
const LEASE_MS = 10 * 60_000;
const DRAIN_MS = 3_000;
let localJobs = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function preflight() {
  const db = await getMongoDb();
  const [players, activeAuctions, activeBuffs, quests, checkins, invalidPlayerIds, duplicatePlayerIds, orphanWallets] = await Promise.all([
    db.collection("progress").countDocuments({}),
    db.collection("auctions").countDocuments({ status: { $in: ["active", "expired"] } }),
    db.collection("serverBuffs").countDocuments({ endsAt: { $gt: new Date().toISOString() } }),
    db.collection("weeklyQuestProgress").countDocuments({}),
    db.collection("checkins").countDocuments({}),
    db.collection("progress").countDocuments({ $or: [{ playerId: { $exists: false } }, { playerId: null }, { playerId: "" }] }),
    db.collection("progress").aggregate([
      { $match: { playerId: { $type: "string", $gt: "" } } },
      { $group: { _id: "$playerId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "count" },
    ]).toArray().then((rows) => rows[0]?.count || 0),
    db.collection("wallets").aggregate([
      { $lookup: { from: "progress", localField: "playerId", foreignField: "playerId", as: "progressRows" } },
      { $match: { progressRows: { $size: 0 } } },
      { $count: "count" },
    ]).toArray().then((rows) => rows[0]?.count || 0),
  ]);
  const online = webPresence.list();
  return { players, activeAuctions, activeBuffs, quests, checkins, invalidPlayerIds, duplicatePlayerIds, orphanWallets, onlinePlayers: online.length, online };
}

async function acquireLock(runId) {
  const db = await getMongoDb();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  try {
    await db.collection(LOCKS).insertOne({ _id: LOCK_ID, runId, status: "running", acquiredAt: now, leaseUntil });
    return true;
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const claimed = await db.collection(LOCKS).findOneAndUpdate(
    { _id: LOCK_ID, $or: [{ status: { $ne: "running" } }, { leaseUntil: { $lt: now } }, { runId }] },
    { $set: { runId, status: "running", acquiredAt: now, leaseUntil } },
    { returnDocument: "after" }
  );
  return Boolean(claimed);
}

async function renewLock(runId) {
  const db = await getMongoDb();
  const result = await db.collection(LOCKS).updateOne(
    { _id: LOCK_ID, runId, status: "running" },
    { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }
  );
  if (!result.matchedCount) throw new Error("換季執行鎖已遺失");
}

async function updateRun(runId, patch) {
  const db = await getMongoDb();
  await db.collection(RUNS).updateOne({ _id: runId }, { $set: { ...patch, updatedAt: new Date().toISOString() } });
}

async function finishLock(runId, status) {
  const db = await getMongoDb();
  await db.collection(LOCKS).updateOne({ _id: LOCK_ID, runId }, { $set: { status, leaseUntil: new Date(), finishedAt: new Date() } });
}

async function runReset(runId, serviceContext = {}) {
  const db = await getMongoDb();
  if (!await acquireLock(runId)) {
    await updateRun(runId, { status: "blocked", error: "另一個全服換季正在執行" });
    return;
  }
  let previousMaintenance = null;
  let leaseTimer = null;
  let mutationStarted = false;
  try {
    const run = await db.collection(RUNS).findOne({ _id: runId });
    if (!run) throw new Error("找不到換季工作");
    leaseTimer = setInterval(() => { renewLock(runId).catch(() => {}); }, 60_000);
    leaseTimer.unref?.();
    await maintenance.refresh();
    previousMaintenance = run.previousMaintenance || maintenance.getRawState();
    await updateRun(runId, { status: "maintenance", previousMaintenance, startedAt: run.startedAt || new Date().toISOString() });
    await maintenance.setState({ enabled: true, strict: true, title: "賽季資料更新中", message: "換季作業進行中，完成並驗證後會重新開放。" });
    serviceContext._broadcastMaintenance?.("換季資料處理中，系統將暫停操作。", 3);
    await delay(DRAIN_MS);

    const seasonKey = String(run.seasonKey || makeSeasonKey());
    const preflightResult = await preflight();
    await updateRun(runId, { status: "preflight", seasonKey, preflight: preflightResult });
    if (preflightResult.invalidPlayerIds || preflightResult.duplicatePlayerIds || preflightResult.orphanWallets) {
      throw new Error(`換季前資料檢查未通過：無效玩家 ${preflightResult.invalidPlayerIds}、重複玩家 ${preflightResult.duplicatePlayerIds}、孤立錢包 ${preflightResult.orphanWallets}`);
    }

    const ids = await listAllPlayerIds();
    const completedRows = await db.collection(CHECKPOINTS).find({ runId, status: "completed" }, { projection: { playerId: 1 } }).toArray();
    const completed = new Set(completedRows.map((row) => String(row.playerId)));
    const latest = await db.collection(RUNS).findOne({ _id: runId });
    let backupWriter = null;
    if (!latest?.backupCompletedAt) {
      backupWriter = createSeasonResetBackupWriter({
        backupDir: run.backupDir || path.resolve(__dirname, "../../../backups"), runId, seasonKey,
      });
      if (fs.existsSync(backupWriter.finalPath)) {
        await updateRun(runId, { backupCompletedAt: new Date().toISOString(), backupPath: backupWriter.finalPath, backupRecovered: true });
        backupWriter = null;
      }
    }
    await updateRun(runId, { status: backupWriter ? "backing_up" : "resetting_players", total: ids.length, processed: completed.size });
    if (backupWriter) {
      const backup = await writeFullSeasonBackup(backupWriter, ids);
      await updateRun(runId, { backupCompletedAt: new Date().toISOString(), backupPath: backup.path, status: "resetting_players" });
    }

    await renewLock(runId);
    mutationStarted = true;
    await seasonState.activate(seasonKey, { runId });
    // 讓其他 PM2 worker 的快取刷新後才開始改 progress。
    await delay(seasonState.REFRESH_MS + 500);

    const summary = await seasonResetAllPlayers({
      dryRun: false,
      monsterService: serviceContext.monsterService,
      passService: serviceContext.passService,
      seasonKey,
      runId,
      keepLedger: run.keepLedger === true,
      resumeCompletedIds: completed,
      onPlayerComplete: async (playerId, playerSummary) => {
        await db.collection(CHECKPOINTS).updateOne(
          { runId, playerId },
          { $set: { status: "completed", summary: playerSummary, completedAt: new Date().toISOString() } },
          { upsert: true }
        );
        completed.add(playerId);
        await updateRun(runId, { status: "resetting_players", processed: completed.size, currentPlayerId: playerId });
        await renewLock(runId);
      },
    });
    if (!summary.completed) throw new Error(summary.finalizationSkipped || summary.globalResetError || "換季未完整完成");

    await updateRun(runId, { status: "validating", summary });
    const validation = await validateSeasonReset({ seasonKey, keepLedger: run.keepLedger === true });
    if (!validation.ok) throw new Error(`換季驗證失敗（${validation.failures.length} 項）`);
    await updateRun(runId, { status: "opening", validation, summary, currentPlayerId: null });
    await maintenance.setState(previousMaintenance);
    serviceContext._broadcastForceReload?.("season_reset_completed", "force", "新賽季資料已完成更新。");
    await finishLock(runId, "completed");
    await updateRun(runId, { status: "completed", completedAt: new Date().toISOString() });
  } catch (error) {
    await updateRun(runId, { status: "failed", failedAt: new Date().toISOString(), error: String(error?.stack || error?.message || error) });
    // 尚未開始資料切換（例如預檢/備份失敗）可恢復原狀；開始後失敗則維持鎖定。
    if (!mutationStarted && previousMaintenance) {
      await maintenance.setState(previousMaintenance).catch(() => {});
    } else {
      await maintenance.setState({ enabled: true, strict: true, title: "賽季資料維護中", message: "換季驗證尚未完成，請等待管理員處理。" }).catch(() => {});
    }
    await finishLock(runId, "failed").catch(() => {});
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
    localJobs.delete(runId);
  }
}

async function createRun({ seasonKey = null, keepLedger = false, backupDir = null, serviceContext = {} } = {}) {
  const db = await getMongoDb();
  const runId = `season_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const doc = {
    _id: runId,
    status: "queued",
    seasonKey: String(seasonKey || makeSeasonKey()),
    keepLedger: keepLedger === true,
    backupDir: backupDir ? path.resolve(backupDir) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.collection(RUNS).insertOne(doc);
  const job = new Promise((resolve) => setImmediate(() => runReset(runId, serviceContext).finally(resolve)));
  localJobs.set(runId, job);
  return doc;
}

async function resumeRun(runId, { serviceContext = {} } = {}) {
  const db = await getMongoDb();
  const run = await db.collection(RUNS).findOne({ _id: String(runId) });
  if (!run) throw new Error("找不到換季工作");
  if (!["failed", "blocked"].includes(run.status)) {
    throw new Error(`狀態 ${run.status} 不允許續跑`);
  }
  if (localJobs.has(run._id)) return run;
  await updateRun(run._id, { status: "queued", error: null, resumedAt: new Date().toISOString() });
  const job = new Promise((resolve) => setImmediate(() => runReset(run._id, serviceContext).finally(resolve)));
  localJobs.set(run._id, job);
  return { ...run, status: "queued" };
}

async function getRun(runId) {
  const db = await getMongoDb();
  return db.collection(RUNS).findOne({ _id: String(runId) });
}

module.exports = { preflight, createRun, resumeRun, getRun, runReset, acquireLock };
