"use strict";

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

async function collection() {
  return (await getMongoDb()).collection("auctions");
}

const auctionRepository = {
  /**
   * 建立新拍賣
   */
  async create(auction) {
    const col = await collection();
    await col.insertOne(auction);
    return auction;
  },

  /**
   * 根據 ID 查詢
   */
  async findById(id) {
    const col = await collection();
    return col.findOne({ id }) || null;
  },

  /**
   * 查詢所有上架中的拍賣（active）
   * 支援篩選：itemType（"equipment" | "gem"）、currency（"gold" | "diamond"）、sort（"price_asc" | "price_desc" | "time_asc" | "time_desc"）
   */
  async findActive({ itemType, currency, sort } = {}) {
    const col = await collection();
    const query = { status: "active" };
    if (itemType === "equipment") query["item.itemType"] = "equipment";
    if (itemType === "gem") query["item.isGem"] = true;
    if (currency) query.currency = currency;

    let cursor = col.find(query);
    if (sort === "price_asc")  cursor = cursor.sort({ price: 1 });
    else if (sort === "price_desc") cursor = cursor.sort({ price: -1 });
    else if (sort === "time_asc")  cursor = cursor.sort({ expiresAt: 1 });
    else cursor = cursor.sort({ createdAt: -1 }); // 預設：最新上架
    return cursor.toArray();
  },

  /**
   * 查詢某玩家的上架（active + expired 待領回）
   */
  async findBySeller(sellerId) {
    const col = await collection();
    return col.find({ sellerId, status: { $in: ["active", "expired"] } }).sort({ createdAt: -1 }).toArray();
  },

  /**
   * 查詢所有到期且還是 active 的拍賣（供定時任務掃描）
   */
  async findExpiredActive() {
    const col = await collection();
    return col.find({ status: "active", expiresAt: { $lte: new Date().toISOString() } }).toArray();
  },

  /**
   * 更新拍賣狀態
   */
  async updateStatus(id, status, extra = {}) {
    const col = await collection();
    await col.updateOne(
      { id },
      { $set: { status, ...extra, updatedAt: new Date().toISOString() } }
    );
  },

  /**
   * 管理後台：查詢所有拍賣（支援分頁）
   */
  async findAll({ status, page = 0, limit = 30 } = {}) {
    const col = await collection();
    const query = {};
    if (status) query.status = status;
    const total = await col.countDocuments(query);
    const items = await col.find(query).sort({ createdAt: -1 }).skip(page * limit).limit(limit).toArray();
    return { items, total };
  },

  /**
   * 強制刪除（管理後台下架用）
   */
  async delete(id) {
    const col = await collection();
    await col.deleteOne({ id });
  },

  /**
   * 取得拍賣場頻道設定
   */
  async getChannelConfig() {
    const db = await getMongoDb();
    const row = await db.collection("auctionConfig").findOne({ _id: "default" });
    return row?.value || { channelId: null };
  },

  /**
   * 儲存拍賣場頻道設定
   */
  async saveChannelConfig(config) {
    const db = await getMongoDb();
    await db.collection("auctionConfig").updateOne(
      { _id: "default" },
      { $set: { value: config, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return config;
  }
};

module.exports = { auctionRepository };
