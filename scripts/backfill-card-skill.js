"use strict";
/**
 * 回填背包內「怪物卡」缺少的 monsterCardSkill 欄位。
 * 寵物採集 / 賭盤掉落先前建立 inventory entry 時沒帶 monsterCardSkill，
 * 導致這些卡片被背包歸到「特殊」而非「卡片」分類。此腳本以道具庫為準，
 * 對 inventory 內 itemId 對應到卡片、但缺 monsterCardSkill 的條目就地補上。
 *
 * 使用 arrayFilters 就地更新單一陣列元素（原子、不整包覆寫），可在伺服器運行中安全執行。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

(async () => {
  const db = await getMongoDb();
  const cards = await db.collection("items")
    .find({ monsterCardSkill: { $exists: true, $ne: null } })
    .project({ id: 1, name: 1, monsterCardSkill: 1 })
    .toArray();
  console.log(`卡片道具數: ${cards.length}`);

  const progressCol = db.collection("progress");
  let totalMatched = 0;
  let totalModified = 0;

  for (const card of cards) {
    const itemId = String(card.id);
    const res = await progressCol.updateMany(
      { "inventory.itemId": itemId },
      { $set: { "inventory.$[elem].monsterCardSkill": card.monsterCardSkill } },
      { arrayFilters: [{ "elem.itemId": itemId, "elem.monsterCardSkill": null }] }
    );
    if (res.modifiedCount > 0) {
      console.log(`  ${card.name} (${itemId}): 修正 ${res.modifiedCount} 位玩家`);
    }
    totalMatched += res.matchedCount;
    totalModified += res.modifiedCount;
  }

  console.log(`\n完成。命中文件 ${totalMatched}、實際修改 ${totalModified}。`);
  process.exit(0);
})().catch((e) => {
  console.error("backfill 失敗:", e);
  process.exit(1);
});
