"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

// ── 設計目標 ──────────────────────────────────────────────────
// D 級裝備玩家 sword_1h：ATK≈12，單輪平均傷害 100~190
// 目標輪數：
//   Lv1 小怪：8~10 輪（3~4人各2~3輪）
//   Lv3 小狼：12 輪（閃避高，難命中）
//   Lv5 大史(B) boss：20 輪（需較多人）
//   Lv5 小金(稀)：8 輪（稀有怪，閃避超高）
//
// 怪物 ATK = str*3（monsterService calcStats 公式）
// 控制 str 讓 Lv1 玩家每輪能撐住
// ──────────────────────────────────────────────────────────────

const UPDATES = [
  // 小史(小) Lv1 — 入門怪，柔軟好打，血厚一點讓新人有打擊感
  { name: "小史(小)", zone: "normal",
    str: 4, agi: 3, vit: 3, int: 1, dex: 3, luk: 1,
    maxHp: 1500, def: 20,
    expReward: 200, goldReward: 160 },

  // 哥布 Lv1 — 普通怪，ATK略高，比小史更有威脅
  { name: "哥布", zone: "normal",
    str: 5, agi: 4, vit: 4, int: 1, dex: 4, luk: 1,
    maxHp: 1750, def: 25,
    expReward: 320, goldReward: 260 },

  // 石頭 Lv1 — 高DEF硬皮型，ATK低但磨血
  { name: "石頭", zone: "normal",
    str: 3, agi: 2, vit: 6, int: 1, dex: 2, luk: 1,
    maxHp: 1450, def: 40,
    expReward: 450, goldReward: 370 },

  // 小狼 Lv3 — 高閃避敏捷型，命中難，血量略高
  { name: "小狼", zone: "normal",
    str: 4, agi: 18, vit: 3, int: 1, dex: 8, luk: 2,
    maxHp: 2100, def: 20,
    expReward: 270, goldReward: 220 },

  // 大史(B) Lv5 — Boss，全面強化，需多人合力
  { name: "大史(B)", zone: "normal",
    str: 10, agi: 12, vit: 8, int: 2, dex: 8, luk: 2,
    maxHp: 3500, def: 50,
    expReward: 1800, goldReward: 1470 },

  // 小金(稀) Lv5 — 稀有怪，閃避極高，ATK強，但HP低；高風險高報酬
  { name: "小金(稀)", zone: "normal",
    str: 20, agi: 80, vit: 5, int: 3, dex: 15, luk: 8,
    maxHp: 1300, def: 10,
    expReward: 500, goldReward: 400 },
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
