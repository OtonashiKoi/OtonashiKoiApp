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
   * 支援篩選：itemType（"equipment" | "card" | "gem" | "pet_egg"）、currency（"gold" | "diamond"）、sort（"price_asc" | "price_desc" | "time_asc" | "time_desc"）
   */
  async findActive({ itemType, currency, sort } = {}) {
    const col = await collection();
    // 只回傳尚未到期的上架（清掃任務可能還沒把過期品翻成 expired，避免買方買到已過期的拍賣）
    const query = { status: "active", expiresAt: { $gt: new Date().toISOString() } };
    if (itemType === "equipment") query["item.itemType"] = "equipment";
    if (itemType === "card") query.$or = [
      { "item.itemType": "monster_card" },
      { "item.monsterCardSkill": { $exists: true } }
    ];
    if (itemType === "gem") query["item.isGem"] = true;
    if (itemType === "pet_egg") query["item.itemType"] = "pet_egg";
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
   * 查詢某玩家的所有上架紀錄（所有狀態，供歷史紀錄頁）
   */
  async findAllBySeller(sellerId, limit = 50) {
    const col = await collection();
    return col.find({ sellerId }).sort({ createdAt: -1 }).limit(limit).toArray();
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
   * 取得拍賣場設定（頻道、開關、上架 Tier）
   * 預設：開啟、C 以上可上架
   */
  async getSettings() {
    const db = await getMongoDb();
    const row = await db.collection("auctionConfig").findOne({ _id: "default" });
    return row?.value || {
      channelId: null,
      enabled: true,
      sellerTiers: ["C", "B", "A", "S", "SS"]
    };
  },

  /**
   * 儲存拍賣場設定
   */
  async saveSettings(settings) {
    const db = await getMongoDb();
    await db.collection("auctionConfig").updateOne(
      { _id: "default" },
      { $set: { value: settings, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return settings;
  },

  // 向下相容舊呼叫
  async getChannelConfig() { return this.getSettings(); },
  async saveChannelConfig(config) { return this.saveSettings(config); }
};

module.exports = { auctionRepository };
