"use strict";

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const REPAIR_ID = "repair-removed-anchors-2026-08-06";
const REMOVED_ITEM_IDS = ["s-legend-reverse-scale", "s-legend-mirror"];

async function main() {
  const db = await getMongoDb();
  const progress = db.collection("progress");
  const affected = await progress.find(
    { "inventory.itemId": { $in: REMOVED_ITEM_IDS } },
    { projection: { _id: 0, playerId: 1, inventory: 1 } },
  ).toArray();

  const entries = affected.flatMap((row) => (row.inventory || [])
    .filter((item) => REMOVED_ITEM_IDS.includes(String(item?.itemId || "")))
    .map((item) => ({ playerId: row.playerId, item })));

  console.log(`找到 ${entries.length} 筆已退役錨點，影響 ${affected.length} 位玩家。`);
  if (!APPLY) {
    console.log("預覽模式，加入 --apply 才會備份並修復。");
    return;
  }
  if (entries.length === 0) {
    console.log("不需要修復。");
    return;
  }

  const existingBackup = await db.collection("dataRepairBackups").findOne({ _id: REPAIR_ID });
  if (!existingBackup) {
    await db.collection("dataRepairBackups").insertOne({
      _id: REPAIR_ID,
      type: "removed_inventory_items",
      itemIds: REMOVED_ITEM_IDS,
      entries,
      createdAt: new Date().toISOString(),
    });
  }

  const result = await progress.updateMany(
    { "inventory.itemId": { $in: REMOVED_ITEM_IDS } },
    {
      $pull: { inventory: { itemId: { $in: REMOVED_ITEM_IDS } } },
      $set: { updatedAt: new Date().toISOString() },
    },
  );
  console.log(`修復完成：更新 ${result.modifiedCount} 位玩家；備份鍵 ${REPAIR_ID}。`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
