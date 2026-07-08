"use strict";
/**
 * 唯一道具發放：某玩家對某 itemId「一生只發一次」（獲得過就不能再獲得，即使賣掉/丟掉也不會再給）。
 * 以 uniqueItemGrants 的唯一索引 {discordId,itemId} 做原子搶佔，避免併發重複發放。
 *
 * 用法：
 *   if (await claim(discordId, itemId, "boss:daishi")) { 真的發物給玩家 }
 *   —— claim 回 true 代表「這次是第一次、成功搶到發放權」；發物若失敗，呼叫 release 撤回。
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COL = "uniqueItemGrants";

/** 是否已經領過（純查詢，不寫入）。 */
async function hasObtained(discordId, itemId) {
  const db = await getMongoDb().catch(() => null);
  if (!db || !discordId || !itemId) return false;
  const doc = await db.collection(COL).findOne(
    { discordId: String(discordId), itemId: String(itemId) },
    { projection: { _id: 1 } }
  ).catch(() => null);
  return Boolean(doc);
}

/**
 * 原子搶佔發放權。
 * @returns {Promise<boolean>} true＝這次是第一次（可發物）；false＝已領過或 DB 異常（不可發）。
 */
async function claim(discordId, itemId, source = null) {
  const db = await getMongoDb().catch(() => null);
  if (!db || !discordId || !itemId) return false; // 保守：無法確認就不發，寧可漏發不重發
  try {
    const r = await db.collection(COL).updateOne(
      { discordId: String(discordId), itemId: String(itemId) },
      { $setOnInsert: { discordId: String(discordId), itemId: String(itemId), source, grantedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return (r.upsertedCount || 0) > 0 || Boolean(r.upsertedId);
  } catch (e) {
    // 唯一索引衝突（E11000）＝已被搶走＝非第一次
    return false;
  }
}

/** 撤回搶佔（發物失敗時呼叫，讓玩家之後還能再拿）。 */
async function release(discordId, itemId) {
  const db = await getMongoDb().catch(() => null);
  if (!db || !discordId || !itemId) return;
  await db.collection(COL).deleteOne({ discordId: String(discordId), itemId: String(itemId) }).catch(() => {});
}

/** 列出某玩家已領過的唯一道具（後台/除錯用）。 */
async function listByPlayer(discordId) {
  const db = await getMongoDb().catch(() => null);
  if (!db || !discordId) return [];
  return db.collection(COL).find({ discordId: String(discordId) }).toArray().catch(() => []);
}

module.exports = { hasObtained, claim, release, listByPlayer };
