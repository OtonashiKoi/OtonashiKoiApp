// scripts/fix-shop-items.js
// 將 shopItems 補上對應 library item 的欄位（tier, equipStats, weaponType, isTwoHanded, atkStat, imageUrl 等）
"use strict";
require("dotenv").config();

async function main() {
  try {
    const { createRepositories } = require("../src/repositories/createRepositories");
    const repos = createRepositories();
    const shopRepo = repos.shopRepository;
    const itemRepo = repos.itemRepository;
    if (!shopRepo || !itemRepo) {
      console.error('Missing repositories (shop or item).');
      process.exit(2);
    }

    const shops = await shopRepo.findAll();
    if (!Array.isArray(shops) || shops.length === 0) {
      console.log('No shop items found.');
      process.exit(0);
    }

    console.log(`Found ${shops.length} shop items. Processing...`);
    let i = 0;
    for (const s of shops) {
      i++;
      try {
        if (!s.itemLibraryId) {
          console.log(`[${i}/${shops.length}] Skip ${s.id} (no itemLibraryId)`);
          continue;
        }
        const lib = await itemRepo.findById(s.itemLibraryId);
        if (!lib) {
          console.log(`[${i}/${shops.length}] No library item for ${s.id} -> ${s.itemLibraryId}`);
          continue;
        }
        const updated = { ...s };
        // copy useful display/equip fields from library
        updated.name = lib.name || updated.name;
        updated.description = lib.description || updated.description;
        updated.itemType = lib.itemType || updated.itemType;
        updated.imageUrl = lib.imageUrl ?? updated.imageUrl;
        updated.imageThumbnailUrl = lib.imageThumbnailUrl ?? updated.imageThumbnailUrl;
        updated.equipSlot = lib.equipSlot ?? updated.equipSlot;
        updated.equipStats = lib.equipStats ?? updated.equipStats;
        updated.weaponType = lib.weaponType ?? updated.weaponType;
        updated.isTwoHanded = lib.isTwoHanded ?? updated.isTwoHanded;
        updated.atkStat = lib.atkStat ?? updated.atkStat;
        updated.tier = lib.tier ?? updated.tier;

        await shopRepo.save(updated);
        console.log(`[${i}/${shops.length}] Updated shop ${s.id} (${updated.name})`);
      } catch (err) {
        console.error(`Failed processing shop ${s.id}:`, err && err.message ? err.message : err);
      }
    }

    console.log('Shop items fix complete.');
    process.exit(0);
  } catch (err) {
    console.error('Fatal:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
