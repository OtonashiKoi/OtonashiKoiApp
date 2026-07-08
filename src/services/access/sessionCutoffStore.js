"use strict";
/**
 * 全服強制重新登入：把「JWT 發出時間(iat) 早於 cutoff」的 token 全部作廢 → 玩家被踢回登入頁。
 * cutoff 存 DB(authConfig / _id=sessionCutoff)，以 unix 秒為單位；0 = 不限制(正常)。
 * requireAuth 讀本模組的快取值判斷；快取每 30 秒自動重載，setCutoff 也會立即更新快取。
 *
 * 用法（強制所有網頁帳號重新登入）：setCutoff(Math.floor(Date.now()/1000))。
 * 之後新登入的 token iat 會晚於 cutoff → 正常；要解除就 setCutoff(0)。
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COLLECTION = "authConfig";
const DOC_ID = "sessionCutoff";
const REFRESH_MS = 30 * 1000;

let cutoff = 0; // unix 秒
let loaded = false;

async function _load() {
  try {
    const db = await getMongoDb();
    const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID });
    cutoff = Math.max(0, Number(doc?.cutoff) || 0);
    loaded = true;
  } catch (_) { /* 讀不到就沿用現值，不擋登入 */ }
}
_load();
const _timer = setInterval(_load, REFRESH_MS);
if (_timer.unref) _timer.unref();

/** 目前的失效門檻(unix 秒)；0=不限制。 */
function getCutoff() { return cutoff; }
function ensureLoaded() { return loaded ? Promise.resolve() : _load(); }

/** 設定門檻並落地 DB。傳現在時間＝強制此刻之前登入的全部 token 失效。 */
async function setCutoff(tsSeconds) {
  cutoff = Math.max(0, Math.floor(Number(tsSeconds) || 0));
  const db = await getMongoDb();
  await db.collection(COLLECTION).updateOne(
    { _id: DOC_ID },
    { $set: { cutoff, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  loaded = true;
  return cutoff;
}

module.exports = { getCutoff, setCutoff, ensureLoaded };
