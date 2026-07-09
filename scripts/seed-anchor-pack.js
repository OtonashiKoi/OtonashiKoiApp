"use strict";
/**
 * 記憶錨定卡包(開箱型消耗品) — 沿用寶箱開箱動畫，加權抽 1 份。
 * 獎池(總 1000‰)：NPC 卡 530‰(A 僅 10‰=1%) + C 階裝備 170‰ + D 階裝備 300‰。
 * 開箱邏輯在 shopService._rollAnchorPack / effect.type "open_anchor_pack"。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// 佔位美術：暫借寶箱圖，之後可換專屬卡包立繪
const IMG = "https://res.cloudinary.com/dxcbxpqmj/image/upload/v1781257153/equipment-game/items/qro9waiflz6vzxcqaknj.png";
const THUMB = "https://res.cloudinary.com/dxcbxpqmj/image/upload/v1781257154/equipment-game/items/j8r25mnywuvgem1xrvx3.webp";

const doc = {
  id: "chest-anchor-pack",
  itemId: "chest-anchor-pack",
  name: "記憶錨定卡包",
  itemName: "記憶錨定卡包",
  description: "開啟後隨機獲得 1 份：主線角色卡(測驗教官 1%／妹妹・IK※A鯉鯉 各4%／報到人員 8%／路人學員・A・B・工作人員 各9%)，或 C/D 階裝備。A 階「測驗教官卡」特別稀有。",
  itemType: "consumable",
  effect: { type: "open_anchor_pack" },
  useEffects: [],
  passiveEffects: [],
  procEffects: [],
  combatEffects: [],
  tier: null,
  rarity: "rare",
  imageUrl: IMG,
  imageThumbnailUrl: THUMB,
  tradeable: false,
  dropable: false,
  sellValue: 0,
  updatedAt: NOW,
};

(async () => {
  const db = await getMongoDb();
  const items = db.collection("items");
  const exist = await items.findOne({ id: doc.id });
  if (exist) {
    await items.updateOne({ id: doc.id }, { $set: doc });
    console.log("♻️  更新 記憶錨定卡包");
  } else {
    doc.createdAt = NOW;
    await items.insertOne(doc);
    console.log("✨ 新增 記憶錨定卡包 (chest-anchor-pack)");
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
