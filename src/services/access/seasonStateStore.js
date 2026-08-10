"use strict";

/**
 * 目前生效的遊戲賽季鍵。progress 寫入會用它作為資料層護欄，避免換季前已經
 * 開始的非同步結算，在換季後把舊資料寫回新存檔。
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COLLECTION = "gameSeasonState";
const DOC_ID = "default";
const LEGACY_KEY = "legacy";
const REFRESH_MS = 2_000;

let activeKey = LEGACY_KEY;
let loaded = false;

async function refresh() {
  try {
    const db = await getMongoDb();
    const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID }, { projection: { activeKey: 1 } });
    activeKey = String(doc?.activeKey || LEGACY_KEY);
    loaded = true;
  } catch (_) {
    // fail-open：DB 暫時不可用時沿用最近一次已知值。
  }
  return activeKey;
}

async function ensureLoaded() {
  if (!loaded) await refresh();
  return activeKey;
}

function getActiveKey() {
  return activeKey;
}

function progressFilter(playerId, expectedKey = activeKey) {
  const id = String(playerId || "");
  const key = String(expectedKey || LEGACY_KEY);
  if (key === LEGACY_KEY) {
    return { playerId: id, $or: [{ seasonKey: LEGACY_KEY }, { seasonKey: { $exists: false } }] };
  }
  return { playerId: id, seasonKey: key };
}

async function activate(nextKey, { runId = null, session = null } = {}) {
  const key = String(nextKey || "").trim();
  if (!key || key === LEGACY_KEY) throw new Error("有效的新 seasonKey 必須提供");
  const db = await getMongoDb();
  const now = new Date().toISOString();
  await db.collection(COLLECTION).updateOne(
    { _id: DOC_ID },
    { $set: { activeKey: key, activatedAt: now, activatedByRunId: runId, updatedAt: now } },
    { upsert: true, session }
  );
  activeKey = key;
  loaded = true;
  return key;
}

refresh().catch(() => {});
const timer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
timer.unref?.();

module.exports = {
  LEGACY_KEY,
  REFRESH_MS,
  ensureLoaded,
  refresh,
  getActiveKey,
  progressFilter,
  activate,
};
