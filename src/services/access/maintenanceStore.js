"use strict";
/**
 * 全域維護模式（賽季結束）狀態。
 * - in-memory + Mongo 持久化（collection "maintenanceState" 文件 _id:"default"），
 *   每 15s 背景刷新，讓多實例 / 外部修改也能反映。
 * - 生效判定：enabled === true，或 activateAt 已到（now >= activateAt）。
 *   → 用 activateAt 可預約「今晚 00:00 自動生效」，不需要有人手動翻開關。
 * - 白名單 discordId：維護期間仍可全功能使用（給開發者）。
 *
 * 安全：未生效時所有 gate 都是 no-op，對既有行為零影響。
 */

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COLLECTION = "maintenanceState";
const DOC_ID = "default";
const REFRESH_MS = 15 * 1000;

// 預設值（DB 沒有文件時的後備）。實際值以 DB 文件為準。
const DEFAULTS = {
  enabled: false,
  activateAt: null, // ISO 字串或 null
  whitelist: ["865264891991425055", "1450019975031951370"], // 音無恋 / 音無醬
  title: "本賽季已結束",
  message: "感謝你的遊玩！🌙\n預計 7/7 前後展開下一季，若有最新消息會在 Discord 公告。\n有任何想法或討論，歡迎來 Discord 找我們聊聊 👇",
  inviteUrl: "https://discord.gg/EfpECVDJF6",
};

let state = { ...DEFAULTS };
let loaded = false;
let loadingPromise = null;

async function _loadFromDb() {
  try {
    const db = await getMongoDb();
    const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID });
    if (doc) {
      state = {
        enabled: doc.enabled === true,
        activateAt: doc.activateAt || null,
        whitelist: Array.isArray(doc.whitelist) ? doc.whitelist.map((x) => String(x)) : DEFAULTS.whitelist,
        title: doc.title || DEFAULTS.title,
        message: doc.message || DEFAULTS.message,
        inviteUrl: doc.inviteUrl || DEFAULTS.inviteUrl,
      };
    }
    loaded = true;
  } catch (_) {
    // 載入失敗保持現狀（fail-open，不誤鎖玩家）
  }
}

function ensureLoaded() {
  if (loaded) return Promise.resolve();
  if (!loadingPromise) loadingPromise = _loadFromDb().finally(() => { loadingPromise = null; });
  return loadingPromise;
}

ensureLoaded();
const _timer = setInterval(() => { _loadFromDb(); }, REFRESH_MS);
if (_timer && typeof _timer.unref === "function") _timer.unref();

/** 維護是否生效（手動開 或 預約時間已到）。 */
function isActive() {
  if (state.enabled === true) return true;
  if (state.activateAt) {
    const t = Date.parse(state.activateAt);
    if (!Number.isNaN(t) && Date.now() >= t) return true;
  }
  return false;
}

/** 是否在白名單（維護期間仍全功能）。 */
function isWhitelisted(discordId) {
  if (!discordId) return false;
  return state.whitelist.includes(String(discordId));
}

/** 前端用的公開資訊（不含白名單）。 */
function getPublicInfo() {
  return {
    active: isActive(),
    title: state.title,
    message: state.message,
    inviteUrl: state.inviteUrl,
  };
}

function getRawState() {
  return { ...state, active: isActive() };
}

/** 更新狀態並持久化（後台用）。 */
async function setState(patch) {
  const next = {
    enabled: patch.enabled !== undefined ? patch.enabled === true : state.enabled,
    activateAt: patch.activateAt !== undefined ? (patch.activateAt || null) : state.activateAt,
    whitelist: Array.isArray(patch.whitelist) ? patch.whitelist.map((x) => String(x)) : state.whitelist,
    title: patch.title !== undefined ? patch.title : state.title,
    message: patch.message !== undefined ? patch.message : state.message,
    inviteUrl: patch.inviteUrl !== undefined ? patch.inviteUrl : state.inviteUrl,
  };
  const db = await getMongoDb();
  await db.collection(COLLECTION).updateOne(
    { _id: DOC_ID },
    { $set: { ...next, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  state = next;
  loaded = true;
  return getRawState();
}

module.exports = { isActive, isWhitelisted, getPublicInfo, getRawState, setState, ensureLoaded };
