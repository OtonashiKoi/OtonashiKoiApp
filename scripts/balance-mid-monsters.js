"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

// ── 設計目標 ──────────────────────────────────────────────────
// 5~6 人，每人打 2~3 輪（每輪最多30回合）合力打死怪物
// C 級裝備玩家 sword_1h：ATK≈33，單輪平均傷害 300~400
// 目標輪數：普通怪 15~18 輪，Boss 25~30 輪
//
// 怪物 ATK = str*3（monsterService calcStats 公式）
// 怪物 ATK 設計：讓 C 級玩家每輪能撐住，不要秒死
// ──────────────────────────────────────────────────────────────

const UPDATES = [
  // 甲蟹 Lv10 — 重甲防守，高DEF高HP，ATK不高
  { name: "甲蟹", zone: "mid",
    str: 10, agi: 4, vit: 14, int: 1, dex: 4, luk: 2,
    maxHp: 6600, def: 50,
    expReward: 4000, goldReward: 3280 },

  // 牙牙狼 Lv10 — 高速敏捷，閃避高，HP較低但難打中
  { name: "牙牙狼", zone: "mid",
    str: 8, agi: 30, vit: 8, int: 1, dex: 22, luk: 6,
    maxHp: 5900, def: 35,
    expReward: 3500, goldReward: 2870 },

  // 巨巨 Lv12 — 重型高ATK，低速，HP厚
  { name: "巨巨", zone: "mid",
    str: 15, agi: 3, vit: 18, int: 1, dex: 3, luk: 1,
    maxHp: 5600, def: 58,
    expReward: 6000, goldReward: 4920 },

  // 黑暗弓手 Lv14 — 遠程精準，命中率高，閃避中等
  { name: "黑暗弓手", zone: "mid",
    str: 9, agi: 20, vit: 8, int: 4, dex: 30, luk: 6,
    maxHp: 6800, def: 42,
    expReward: 4200, goldReward: 3440 },

  // 米拉桑(B) Lv15 — Boss，全能均衡，需最多人合力
  { name: "米拉桑(B)", zone: "mid",
    str: 18, agi: 22, vit: 18, int: 8, dex: 18, luk: 10,
    maxHp: 7200, def: 60,
    expReward: 12000, goldReward: 9840 },
];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");

  for (const u of UPDATES) {
    const { name, zone, ...fields } = u;
    const result = await db.collection("monsters").updateOne(
      { name, zone },
      { $set: fields }
    );
    console.log(`${name}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }

  await client.close();
  console.log("Done.");
})();
