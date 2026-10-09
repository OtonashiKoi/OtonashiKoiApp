"use strict";

const assert = require("node:assert/strict");
const { hydrateAuctionImages } = require("../src/api/auctionImages");
const { createPlayerAppRoutes } = require("../src/api/routes/playerAppRoutes");

async function run() {
  const rows = [
    { id: "card-1", price: 5000, quantity: 1, item: { itemId: "card", itemName: "卡片", equipStats: { int: 4 }, enhanceLevel: 2 } },
    { id: "card-2", item: { itemId: "card", imageThumbnailUrl: "/old-card.png" } },
    { id: "gear", item: { itemId: "gear", imageThumbnailUrl: "/stale-gear.png" } },
    { id: "pet", item: { __pet: true, imageUrl: "/pet.png" } },
    { id: "missing", item: { itemId: "missing", imageUrl: "/snapshot.png" } },
    { id: "broken", item: { itemId: "broken", imageThumbnailUrl: "/snapshot-thumb.png" } },
    { id: "legacy", imageUrl: "/legacy.png" },
    { id: "no-art", item: { itemId: "no-art" } },
  ];
  const before = structuredClone(rows);
  const calls = [];
  const itemRepository = { findById: async id => {
    calls.push(id);
    if (id === "broken") throw new Error("catalog temporarily unavailable");
    return { card: { imageUrl: "/card.png", imageThumbnailUrl: "/card-thumb.png" }, gear: { imageUrl: "/gear.png" } }[id] || null;
  } };
  const hydrated = await hydrateAuctionImages(rows, itemRepository);
  assert.deepEqual(hydrated.map(row => row.imageUrl), ["/card-thumb.png", "/card-thumb.png", "/gear.png", "/pet.png", "/snapshot.png", "/snapshot-thumb.png", "/legacy.png", null]);
  assert.equal(calls.filter(id => id === "card").length, 1);
  assert.deepEqual(rows, before);
  assert.deepEqual(hydrated[0].item, rows[0].item);
  assert.equal(hydrated[0].price, 5000);
  assert.equal(hydrated[0].quantity, 1);
  assert.deepEqual(await hydrateAuctionImages(null, itemRepository), []);

  // 執行三個真正的 GET handler，驗證 DTO 最後沒有用舊快照覆蓋補齊的圖片。
  const auctionService = {
    getActiveListings: async () => rows,
    getMyListings: async () => rows,
    getMyHistory: async () => rows,
    isEnabled: async () => true,
    getMaxListings: async () => 10,
    checkSellerEligibility: async () => true,
  };
  const router = createPlayerAppRoutes({ auctionService, itemRepository }, null);
  for (const [path, key] of [["/api/auction/list", "listings"], ["/api/auction/my", "listings"], ["/api/auction/history", "history"]]) {
    const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods.get);
    assert.ok(layer, path);
    let response;
    await layer.route.stack.at(-1).handle({ query: {}, playerRecord: { discordId: "test" } }, { json: body => { response = body; } }, error => { throw error; });
    assert.equal(response.data[key].find(row => row.id === "card-1").imageUrl, "/card-thumb.png", path);
    assert.equal(response.data[key].find(row => row.id === "gear").imageUrl, "/gear.png", path);
    assert.equal(response.data[key].find(row => row.id === "pet").imageUrl, "/pet.png", path);
  }
  assert.deepEqual(rows, before);
  console.log("PASS: 拍賣圖片缺快照、庫圖更新、查詢去重、寵物、舊資料、失敗降級及三個正式 GET handler；無 DB 寫入。");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
