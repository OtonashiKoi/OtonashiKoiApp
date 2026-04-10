// scripts/sync-lib-to-players.js
// 將道具庫（item library）欄位同步回所有玩家的 `inventory` 與 `equipment`。
// 用法: node scripts/sync-lib-to-players.js
"use strict";
require("dotenv").config();
const path = require("path");

async function main() {
  try {
    // 載入專案 repositories 與服務
    const { createRepositories } = require("../src/repositories/createRepositories");
    const { ItemService } = require("../src/services/item/itemService");

    const repos = createRepositories();
    const itemRepo = repos.itemRepository;
    const progressRepo = repos.progressRepository;

    if (!itemRepo || !progressRepo) {
      console.error("Missing repositories (item or progress). Check storage driver and config.");
      process.exit(2);
    }

    const items = await itemRepo.findAll();
    if (!Array.isArray(items) || items.length === 0) {
      console.log("No library items found, nothing to sync.");
      process.exit(0);
    }

    const itemService = new ItemService(itemRepo, progressRepo);

    console.log(`Syncing ${items.length} library items to players...`);
    let count = 0;
    // 也載入 shopRepository，用於處理玩家透過商店購買時，inventory.itemId 為 shopItem.id 的情況
    const shopRepo = repos.shopRepository;
    const shopItems = shopRepo ? await shopRepo.findAll() : [];

    for (const libItem of items) {
      try {
        console.log(`[${++count}/${items.length}] Syncing: ${libItem.id} - ${libItem.name}`);
        // 1) 先用原本的同步（處理直接以 library.id 為 itemId 的情況）
        await itemService._syncItemToPlayers(libItem);

        // 2) 若有 shop items 參考此 library，針對每個 shopItem.id 建立一份 clone 並同步
        const relatedShops = shopItems.filter(s => s.itemLibraryId === libItem.id);
        for (const s of relatedShops) {
          try {
            const fakeLib = { ...libItem, id: s.id };
            await itemService._syncItemToPlayers(fakeLib);
          } catch (e) {
            console.error(`  (shop-mapped) Failed to sync shopItem ${s.id}:`, e && e.message ? e.message : e);
          }
        }
      } catch (err) {
        console.error(`Failed to sync ${libItem.id}:`, err && err.message ? err.message : err);
      }
    }

    console.log("Sync complete.");
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
