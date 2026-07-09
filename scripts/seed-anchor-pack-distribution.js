"use strict";
/**
 * 記憶錨定卡包三管道分發：
 *  ① 金幣商城 50000/包(不限購)
 *  ② 三隻世界王掉落 10%(大史王/古龍王/地獄狼牙王)
 *  ③ 每日任務「每日記憶錨定」(贏1場→1包)  — 直接插 weeklyQuests(重啟 seeder 亦會建、以 title|type|cadence 去重不重複)
 * 冪等：重跑不重複。
 */
require("dotenv").config();
const crypto = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();
const PACK_ID = "chest-anchor-pack";
const PACK_NAME = "記憶錨定卡包";
const BOSS_IDS = ["elite-daishi-king", "dragon-king-boss", "0393acee-9851-4bcb-a8f5-fdb60a9968f1"];
const BOSS_DROP_CHANCE = 10; // %

(async () => {
  const db = await getMongoDb();
  const items = db.collection("items");
  const pack = await items.findOne({ id: PACK_ID });
  if (!pack) { console.error("❌ 找不到卡包物品，請先跑 seed-anchor-pack.js"); process.exit(1); }

  // ① 金幣商城 -----------------------------------------------------------
  const shop = db.collection("shopItems");
  const existShop = await shop.findOne({ itemLibraryId: PACK_ID });
  const shopDoc = {
    itemLibraryId: PACK_ID,
    name: pack.name, description: pack.description,
    price: 50000, currency: "gold",
    stock: -1, enabled: true, isSale: false,
    allowedTiers: [], maxPerMonth: 0, claimLimit: null,
    itemType: pack.itemType || "consumable",
    effect: pack.effect || { type: "open_anchor_pack" },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    imageUrl: pack.imageUrl || null, imageThumbnailUrl: pack.imageThumbnailUrl || null,
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false, tier: null,
  };
  if (existShop) {
    await shop.updateOne({ id: existShop.id }, { $set: shopDoc });
    console.log("♻️  商城更新：記憶錨定卡包 50000 金幣");
  } else {
    await shop.insertOne({ id: crypto.randomUUID(), ...shopDoc, createdAt: NOW });
    console.log("✨ 商城上架：記憶錨定卡包 50000 金幣(不限購)");
  }

  // ② 世界王掉落 ---------------------------------------------------------
  const monsters = db.collection("monsters");
  for (const bid of BOSS_IDS) {
    const m = await monsters.findOne({ id: bid });
    if (!m) { console.log("⚠️ 找不到世界王:", bid); continue; }
    const drops = Array.isArray(m.drops) ? m.drops.slice() : [];
    const idx = drops.findIndex(d => d.itemId === PACK_ID);
    if (idx >= 0) { drops[idx] = { itemId: PACK_ID, itemName: PACK_NAME, chance: BOSS_DROP_CHANCE }; }
    else { drops.push({ itemId: PACK_ID, itemName: PACK_NAME, chance: BOSS_DROP_CHANCE }); }
    await monsters.updateOne({ id: bid }, { $set: { drops, updatedAt: NOW } });
    console.log(`✨ ${m.name} 掉落表 +記憶錨定卡包 ${BOSS_DROP_CHANCE}%`);
  }

  // ③ 每日任務 -----------------------------------------------------------
  const wq = db.collection("weeklyQuests");
  const existQuest = await wq.findOne({ cadence: "daily", type: "battle_win", title: "每日記憶錨定" });
  if (existQuest) {
    console.log("♻️  每日任務已存在：每日記憶錨定");
  } else {
    await wq.insertOne({
      id: crypto.randomUUID(),
      cadence: "daily", type: "battle_win", target: 1,
      title: "每日記憶錨定",
      description: "每日贏得 1 場戰鬥，領取 1 包記憶錨定卡包。",
      rewardGold: 0, rewardExp: 0, rewardDiamond: 0,
      rewardItemId: PACK_ID,
      hideIfRewardOwned: false, claimOnce: false,
      enabled: true, levelLimit: 0, resetPolicy: "tw_daily",
      sortOrder: 50, groupKey: "anchor_v1",
      createdAt: NOW, updatedAt: NOW,
    });
    console.log("✨ 每日任務新增：每日記憶錨定(贏1場→1包)");
  }

  console.log("\n三管道分發完成。");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
