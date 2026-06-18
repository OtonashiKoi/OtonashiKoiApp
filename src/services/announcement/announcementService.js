"use strict";
/**
 * 公告系統:首頁公告版位 + 後台發布。
 * - announcements：公告本體 { id, title, body, imageUrl, enabled, pinned, createdAt, updatedAt }
 * - announcementReads：每位玩家已讀的公告 id { _id: discordId, readIds: [] }
 */

const crypto = require("crypto");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

async function _col() { return (await getMongoDb()).collection("announcements"); }
async function _reads() { return (await getMongoDb()).collection("announcementReads"); }

function _clean(a) {
  if (!a) return null;
  return {
    id: a.id,
    title: a.title || "",
    body: a.body || "",
    imageUrl: a.imageUrl || null,
    enabled: a.enabled !== false,
    pinned: !!a.pinned,
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null
  };
}

// pinned 在前,其次新到舊
function _sort(list) {
  return list.sort((x, y) => (Number(y.pinned) - Number(x.pinned)) || String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
}

/** 玩家端:啟用中的公告 + 該玩家已讀狀態 */
async function listForPlayer(discordId) {
  const id = String(discordId || "").trim();
  const col = await _col();
  const rows = (await col.find({ enabled: { $ne: false } }).toArray()).map(_clean);
  const readDoc = id ? await (await _reads()).findOne({ _id: id }) : null;
  const readSet = new Set(Array.isArray(readDoc?.readIds) ? readDoc.readIds : []);
  return _sort(rows).map((a) => ({ ...a, read: readSet.has(a.id) }));
}

/** 標記已讀 */
async function markRead(discordId, announcementId) {
  const id = String(discordId || "").trim();
  const aid = String(announcementId || "").trim();
  if (!id || !aid) return;
  await (await _reads()).updateOne({ _id: id }, { $addToSet: { readIds: aid }, $set: { updatedAt: new Date().toISOString() } }, { upsert: true });
}

/** 後台:全部公告(含停用) */
async function listAll() {
  const col = await _col();
  return _sort((await col.find({}).toArray()).map(_clean));
}

/** 後台:新增公告 */
async function create({ title, body, imageUrl = null, enabled = true, pinned = false }) {
  if (!String(title || "").trim()) throw new Error("公告標題不可空白");
  const now = new Date().toISOString();
  const doc = {
    id: crypto.randomUUID(),
    title: String(title).trim(),
    body: String(body || ""),
    imageUrl: imageUrl ? String(imageUrl).trim() : null,
    enabled: enabled !== false,
    pinned: !!pinned,
    createdAt: now,
    updatedAt: now
  };
  await (await _col()).insertOne(doc);
  return _clean(doc);
}

/** 後台:更新 */
async function update(id, fields = {}) {
  const set = { updatedAt: new Date().toISOString() };
  if (fields.title !== undefined) set.title = String(fields.title).trim();
  if (fields.body !== undefined) set.body = String(fields.body || "");
  if (fields.imageUrl !== undefined) set.imageUrl = fields.imageUrl ? String(fields.imageUrl).trim() : null;
  if (fields.enabled !== undefined) set.enabled = fields.enabled !== false;
  if (fields.pinned !== undefined) set.pinned = !!fields.pinned;
  await (await _col()).updateOne({ id: String(id) }, { $set: set });
  return _clean(await (await _col()).findOne({ id: String(id) }));
}

/** 後台:刪除 */
async function remove(id) {
  await (await _col()).deleteOne({ id: String(id) });
  return { removed: String(id) };
}

module.exports = { listForPlayer, markRead, listAll, create, update, remove };
