"use strict";
/**
 * Discord 頭像快取。玩家頭像不存 DB,改用 discord.js(本身有 user 快取)按需取得,
 * 再用本模組做 TTL 快取 + 去抖,避免重複打 Discord API。
 * getCached() 同步回傳(供 API 立即組資料);prime() 背景補抓(下次輪詢就有)。
 */

let _client = null;
function setClient(client) { _client = client; }

const cache = new Map();   // discordId -> { url, ts }
const inflight = new Set();
const TTL = 60 * 60 * 1000; // 1 小時

function getCached(discordId) {
  const id = String(discordId || "").trim();
  const e = cache.get(id);
  return e ? e.url : null;
}

function prime(discordId) {
  const id = String(discordId || "").trim();
  if (!id || !_client || inflight.has(id)) return;
  const e = cache.get(id);
  if (e && Date.now() - e.ts < TTL) return;
  inflight.add(id);
  Promise.resolve(_client.users.fetch(id, { force: false }))
    .then((u) => { cache.set(id, { url: u.displayAvatarURL({ size: 128, extension: "png" }), ts: Date.now() }); })
    .catch(() => { cache.set(id, { url: null, ts: Date.now() }); })
    .finally(() => inflight.delete(id));
}

/** 取得頭像:有快取直接回,沒有則觸發背景補抓並先回 null */
function get(discordId) {
  const url = getCached(discordId);
  if (url === null) prime(discordId);
  return url;
}

module.exports = { setClient, getCached, prime, get };
