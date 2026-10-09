"use strict";

// 上架快照保留交易數值；顯示圖片與背包一樣讀最新道具庫，絕不回寫託管物品。
async function hydrateAuctionImages(listings, itemRepository) {
  const rows = Array.isArray(listings) ? listings : [];
  const ids = [...new Set(rows.map(row => row.item?.itemId).filter(Boolean))];
  const images = new Map(await Promise.all(ids.map(async id => {
    try {
      const item = await itemRepository.findById(id);
      return [id, item?.imageThumbnailUrl || item?.imageUrl || null];
    } catch (_) {
      return [id, null]; // 庫資料讀取失敗仍能顯示快照圖片及其他商品。
    }
  })));
  return rows.map(row => ({
    ...row,
    imageUrl: images.get(row.item?.itemId)
      || row.item?.imageThumbnailUrl || row.item?.imageUrl || row.imageUrl || null,
  }));
}

module.exports = { hydrateAuctionImages };
