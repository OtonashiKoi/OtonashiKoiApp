"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

const client = new MongoClient("mongodb://localhost:27017");

// 道具庫項目 ID（固定，不可改）
const ITEM_IDS = {
  potion_hp_s:  "f56aefd0-faa8-45b5-8451-fbbae5810c74",
  potion_hp_m:  "97fbd546-e207-4130-b130-2fadd799703a",
  potion_hp_l:  "3eb1d302-3d04-40a5-8335-1f9ed844dc27",
  potion_rev_s: "12bfb110-6489-4784-8537-f3f496759f8f",
  potion_rev_l: "c4794326-ced1-4efe-983d-17c14ee2f2f8",
};

const LIBRARY_ITEMS = [
  {
    id: ITEM_IDS.potion_hp_s,
    name: "回復藥水（小）",
    description: "爬塔專用。恢復指定隊員 80 HP，僅限存活隊員使用。",
    itemType: "tower_consumable",
    effect: { type: "tower_heal_flat", value: 80 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
    tier: null, imageUrl: null, imageThumbnailUrl: null,
  },
  {
    id: ITEM_IDS.potion_hp_m,
    name: "回復藥水（中）",
    description: "爬塔專用。恢復指定隊員 200 HP，僅限存活隊員使用。",
    itemType: "tower_consumable",
    effect: { type: "tower_heal_flat", value: 200 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
    tier: null, imageUrl: null, imageThumbnailUrl: null,
  },
  {
    id: ITEM_IDS.potion_hp_l,
    name: "回復藥水（大）",
    description: "爬塔專用。恢復指定隊員 50% 最大 HP，僅限存活隊員使用。",
    itemType: "tower_consumable",
    effect: { type: "tower_heal_pct", value: 50 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
    tier: null, imageUrl: null, imageThumbnailUrl: null,
  },
  {
    id: ITEM_IDS.potion_rev_s,
    name: "復活藥水（小）",
    description: "爬塔專用。復活已陣亡的指定隊員，並恢復其 30% 最大 HP。",
    itemType: "tower_consumable",
    effect: { type: "tower_revive_pct", value: 30 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
    tier: null, imageUrl: null, imageThumbnailUrl: null,
  },
  {
    id: ITEM_IDS.potion_rev_l,
    name: "復活藥水（大）",
    description: "爬塔專用。復活已陣亡的指定隊員，並恢復其 70% 最大 HP。",
    itemType: "tower_consumable",
    effect: { type: "tower_revive_pct", value: 70 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
    tier: null, imageUrl: null, imageThumbnailUrl: null,
  },
];

// 商店品項（每種限持有 3 罐，購買時由 shopService 檢查背包）
const SHOP_PRICES = {
  [ITEM_IDS.potion_hp_s]:  3000,
  [ITEM_IDS.potion_hp_m]:  8000,
  [ITEM_IDS.potion_hp_l]:  18000,
  [ITEM_IDS.potion_rev_s]: 12000,
  [ITEM_IDS.potion_rev_l]: 30000,
};

async function main() {
  await client.connect();
  const db = client.db("equipment_game");
  const { randomUUID } = require("crypto");
  const now = new Date().toISOString();

  let libAdded = 0, shopAdded = 0;

  for (const item of LIBRARY_ITEMS) {
    const exists = await db.collection("items").findOne({ id: item.id });
    if (!exists) {
      await db.collection("items").insertOne({ ...item, createdAt: now, updatedAt: now });
      libAdded++;
      console.log("items 新增：" + item.name);
    } else {
      // 更新 effect 以防舊資料
      await db.collection("items").updateOne({ id: item.id }, { $set: { effect: item.effect, itemType: item.itemType, description: item.description, updatedAt: now } });
      console.log("items 已存在，更新：" + item.name);
    }
  }

  for (const item of LIBRARY_ITEMS) {
    const price = SHOP_PRICES[item.id];
    const exists = await db.collection("shopItems").findOne({ itemLibraryId: item.id });
    if (!exists) {
      await db.collection("shopItems").insertOne({
        id: randomUUID(),
        itemLibraryId: item.id,
        name: item.name,
        description: item.description,
        itemType: "tower_consumable",
        currency: "gold",
        price,
        stock: -1,           // 無限庫存
        maxPerMonth: 0,       // 不用月限，改由背包持有量控制
        maxOwn: 3,            // 購買時背包上限 3 罐
        enabled: true,
        isSale: false,
        allowedTiers: [],
        equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
        effect: item.effect,
        useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
        createdAt: now,
      });
      shopAdded++;
      console.log("shopItems 新增：" + item.name + " 售價 " + price + " 金");
    } else {
      console.log("shopItems 已存在：" + item.name);
    }
  }

  console.log("\n完成。items 新增:", libAdded, "| shopItems 新增:", shopAdded);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
