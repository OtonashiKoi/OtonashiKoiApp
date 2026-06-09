"use strict";
/**
 * 建立 S 階強化寶石，並讓兩隻世界王 15% 掉落（idempotent，可重複執行）。
 *   - items: gem-s-tier「S階寶石」(tier S, consumable)
 *   - monsters elite-daishi-king / dragon-king-boss 的 drops 加入 {itemId:gem-s-tier, chance:15}
 * 註：S 寶石用於強化 S 階裝備（龍系武器），enhanceConfig 已開通 S 階強化。
 */
require("dotenv").config();

const GEM_ID = "gem-s-tier";
const GEM_NAME = "S階寶石";
const DROP_CHANCE = 15;
const BOSS_IDS = ["elite-daishi-king", "dragon-king-boss"];

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const now = new Date().toISOString();

  // 1) 建立/更新 S 階寶石道具
  const existing = await db.collection("items").findOne({ id: GEM_ID });
  const gemDoc = {
    id: GEM_ID,
    name: GEM_NAME,
    description: "用於強化 S 階裝備（如龍系 S 武器）。世界王有機率掉落。",
    itemType: "consumable",
    tier: "S",
    effect: existing?.effect || { type: "none", value: 5000 },
    imageUrl: existing?.imageUrl || null,
    imageThumbnailUrl: existing?.imageThumbnailUrl || null,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };
  await db.collection("items").updateOne({ id: GEM_ID }, { $set: gemDoc }, { upsert: true });
  console.log(`${existing ? "已更新" : "已建立"} 道具：${GEM_NAME} (id=${GEM_ID}, tier=S)`);

  // 2) 加進兩隻世界王掉落表
  for (const bid of BOSS_IDS) {
    const mon = await db.collection("monsters").findOne({ id: bid });
    if (!mon) { console.log(`⚠️ 找不到世界王 ${bid}，略過`); continue; }
    const drops = Array.isArray(mon.drops) ? mon.drops.slice() : [];
    const idx = drops.findIndex((d) => d && d.itemId === GEM_ID);
    if (idx >= 0) {
      drops[idx] = { ...drops[idx], itemName: GEM_NAME, chance: DROP_CHANCE };
      console.log(`  ${mon.name}：已更新 S寶石掉落為 ${DROP_CHANCE}%`);
    } else {
      drops.push({ itemId: GEM_ID, itemName: GEM_NAME, chance: DROP_CHANCE });
      console.log(`  ${mon.name}：已新增 S寶石掉落 ${DROP_CHANCE}%`);
    }
    await db.collection("monsters").updateOne({ id: bid }, { $set: { drops, updatedAt: now } });
  }

  console.log("\n完成。S 階強化已開通；寶箱獎池已排除 S 寶石（只走實戰 15% 掉落）。");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
