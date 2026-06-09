"use strict";
/**
 * 建立兩個世界王寶箱消耗品（idempotent，可重複執行）。
 * 使用時依該世界王「即時掉落表」的 chance 權重隨機獲得一份掉落物，並公告到通知頻道。
 *   大史王寶箱  → monsterId: elite-daishi-king
 *   古龍王寶箱  → monsterId: dragon-king-boss
 */
require("dotenv").config();

const CHESTS = [
  {
    id: "chest-daishi-king",
    name: "大史王寶箱",
    description: "開啟後，依大史王的掉落比重隨機獲得一份其掉落物。",
    effect: { type: "open_world_boss_chest", monsterId: "elite-daishi-king", bossName: "大史王" },
  },
  {
    id: "chest-dragon-king",
    name: "古龍王寶箱",
    description: "開啟後，依古龍王的掉落比重隨機獲得一份其掉落物。",
    effect: { type: "open_world_boss_chest", monsterId: "dragon-king-boss", bossName: "古龍王" },
  },
];

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const items = db.collection("items");
  const monsters = db.collection("monsters");
  const now = new Date().toISOString();

  for (const c of CHESTS) {
    // 驗證對應世界王存在且有掉落表
    const mon = await monsters.findOne({ id: c.effect.monsterId });
    const dropCount = Array.isArray(mon?.drops) ? mon.drops.filter((d) => d && d.itemId && Number(d.chance) > 0).length : 0;
    if (!mon) { console.log(`⚠️  找不到世界王 ${c.effect.monsterId}，仍會建立寶箱但開箱會失敗`); }
    else { console.log(`✓ ${c.name} 對應 ${mon.name}，可抽掉落 ${dropCount} 種`); }

    const existing = await items.findOne({ id: c.id });
    const doc = {
      id: c.id,
      name: c.name,
      description: c.description,
      itemType: "consumable",
      effect: c.effect,
      imageUrl: existing?.imageUrl || null,
      imageThumbnailUrl: existing?.imageThumbnailUrl || null,
      updatedAt: now,
      createdAt: existing?.createdAt || now,
    };
    await items.updateOne({ id: c.id }, { $set: doc }, { upsert: true });
    console.log(`${existing ? "已更新" : "已建立"}：${c.name} (id=${c.id})`);
  }

  console.log("\n完成。發放方式（擇一，未自動掛上）：後台給道具 / 商店 / 掉落。");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
