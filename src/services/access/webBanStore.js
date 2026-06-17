"use strict";
/**
 * 網頁封鎖名單(in-memory Set + Mongo 持久化)。
 * requireAuth / SSE 端點每次請求都會用 isBlocked() 同步檢查,故用記憶體 Set,
 * 並背景定時 + 變更時同步 Mongo,讓多實例/外部修改也能反映。
 *
 * Mongo: collection "webAccessControl" 文件 { _id: "blocklist", ids: [discordId...], updatedAt }
 */

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COLLECTION = "webAccessControl";
const DOC_ID = "blocklist";
const REFRESH_MS = 30 * 1000;

let blocked = new Set();
let loaded = false;
let loadingPromise = null;

async function _loadFromDb() {
  try {
    const db = await getMongoDb();
    const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID });
    blocked = new Set(Array.isArray(doc?.ids) ? doc.ids.map((x) => String(x)) : []);
    loaded = true;
  } catch (_) {
    // 載入失敗保持現狀(fail-open),不阻擋正常玩家
  }
}

function ensureLoaded() {
  if (loaded) return Promise.resolve();
  if (!loadingPromise) loadingPromise = _loadFromDb().finally(() => { loadingPromise = null; });
  return loadingPromise;
}

// 啟動先載一次,之後定時刷新
ensureLoaded();
const _timer = setInterval(() => { _loadFromDb(); }, REFRESH_MS);
if (_timer && typeof _timer.unref === "function") _timer.unref();

async function _persist() {
  const db = await getMongoDb();
  await db.collection(COLLECTION).updateOne(
    { _id: DOC_ID },
    { $set: { ids: [...blocked], updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

/** 同步檢查是否被封鎖(讀記憶體 Set) */
function isBlocked(discordId) {
  return blocked.has(String(discordId || "").trim());
}

/** 封鎖一名玩家 */
async function block(discordId) {
  const id = String(discordId || "").trim();
  if (!id) return [...blocked];
  blocked.add(id);
  await _persist();
  return [...blocked];
}

/** 解除封鎖 */
async function unblock(discordId) {
  const id = String(discordId || "").trim();
  blocked.delete(id);
  await _persist();
  return [...blocked];
}

/** 取得目前封鎖名單(陣列) */
async function list() {
  await ensureLoaded();
  return [...blocked];
}

module.exports = { isBlocked, block, unblock, list, ensureLoaded };
