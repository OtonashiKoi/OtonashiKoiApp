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
const REFRESH_MS = 60 * 1000; // 背景刷新只為「後台改設定不用重啟就生效」；到點自動開/關服是即時現算，不靠這個

// 預設值（DB 沒有文件時的後備）。實際值以 DB 文件為準。
const DEFAULTS = {
  enabled: false,
  openAt: null,     // ISO：此時間「之前」＝尚未開服(擋登入,顯示 openTitle/openMessage)。null=不限開服時間
  activateAt: null, // ISO：此時間「到了」＝賽季結束(擋登入)。用來排程關服。
  whitelist: ["865264891991425055", "1450019975031951370"], // 音無恋 / 音無醬
  title: "本賽季已結束",
  message: "感謝你的遊玩！🌙\n預計 7/7 前後展開下一季，若有最新消息會在 Discord 公告。\n有任何想法或討論，歡迎來 Discord 找我們聊聊 👇",
  openTitle: "新賽季即將開放",
  openMessage: "伺服器即將開放，敬請期待！開服後就能登入囉 ⚔️",
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
        openAt: doc.openAt || null,
        activateAt: doc.activateAt || null,
        whitelist: Array.isArray(doc.whitelist) ? doc.whitelist.map((x) => String(x)) : DEFAULTS.whitelist,
        title: doc.title || DEFAULTS.title,
        message: doc.message || DEFAULTS.message,
        openTitle: doc.openTitle || DEFAULTS.openTitle,
        openMessage: doc.openMessage || DEFAULTS.openMessage,
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

// 尚未開服：設了 openAt 且現在還沒到。
function _beforeOpen() {
  if (!state.openAt) return false;
  const t = Date.parse(state.openAt);
  return !Number.isNaN(t) && Date.now() < t;
}
// 已關服(賽季結束)：設了 activateAt 且已到。
function _afterClose() {
  if (!state.activateAt) return false;
  const t = Date.parse(state.activateAt);
  return !Number.isNaN(t) && Date.now() >= t;
}

/** 維護/擋登入是否生效（手動開 / 尚未開服 / 已關服）。 */
function isActive() {
  return state.enabled === true || _beforeOpen() || _afterClose();
}

/** 目前階段：pre_open(未開服) / open(開放中) / closed(手動維護或已關服)。 */
function getPhase() {
  if (_beforeOpen()) return "pre_open";
  if (state.enabled === true || _afterClose()) return "closed";
  return "open";
}

/** 是否在白名單（維護期間仍全功能）。 */
function isWhitelisted(discordId) {
  if (!discordId) return false;
  return state.whitelist.includes(String(discordId));
}

/** 前端用的公開資訊（不含白名單）。未開服顯示 openTitle/openMessage，已關服顯示 title/message。 */
function getPublicInfo() {
  const preOpen = _beforeOpen();
  return {
    active: isActive(),
    phase: getPhase(),
    title: preOpen ? state.openTitle : state.title,
    message: preOpen ? state.openMessage : state.message,
    openAt: state.openAt,
    inviteUrl: state.inviteUrl,
  };
}

function getRawState() {
  return { ...state, active: isActive(), phase: getPhase() };
}

/** 更新狀態並持久化（後台用）。 */
async function setState(patch) {
  const next = {
    enabled: patch.enabled !== undefined ? patch.enabled === true : state.enabled,
    openAt: patch.openAt !== undefined ? (patch.openAt || null) : state.openAt,
    activateAt: patch.activateAt !== undefined ? (patch.activateAt || null) : state.activateAt,
    whitelist: Array.isArray(patch.whitelist) ? patch.whitelist.map((x) => String(x)) : state.whitelist,
    title: patch.title !== undefined ? patch.title : state.title,
    message: patch.message !== undefined ? patch.message : state.message,
    openTitle: patch.openTitle !== undefined ? patch.openTitle : state.openTitle,
    openMessage: patch.openMessage !== undefined ? patch.openMessage : state.openMessage,
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
