"use strict";
/**
 * 幫裝備標記 setKey/setName（具名套裝）。
 *   火焰裝(id fire-*) → hellfire / 焚獄套裝；同時清掉焰鱗甲舊的 condition.all 焚獄之王(改由引擎統一產生)
 *   秘銀/鋼鐵 A 裝    → mithril / 秘銀套裝
 * 可重複執行。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { SET_SLOTS } = require("../src/shared/equipmentSetBonuses");
const NOW = new Date().toISOString();

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const items = db.collection("items");
  const slotSet = new Set(SET_SLOTS);

  let fire = 0, mithril = 0, cleared = 0;

  // 火焰裝
  const fireItems = await items.find({ id: /^fire-/ }).toArray();
  for (const it of fireItems) {
    const set = { setKey: "hellfire", setName: "焚獄套裝", updatedAt: NOW };
    // 焰鱗甲：清掉舊的 condition.all 焚獄之王(現由 equipmentSetBonuses 產生)，避免雙算
    if (it.id === "fire-a-arm-armor") { set.passiveEffects = []; cleared++; }
    if (!dry) await items.updateOne({ _id: it._id }, { $set: set });
    fire++;
  }
  console.log(`火焰裝 → hellfire：${fire} 件（清焰鱗甲舊套裝效果 ${cleared}）`);

  // 秘銀/鋼鐵 A 裝（在套裝計入槽位內）
  const stdItems = await items.find({
    itemType: "equipment", tier: "A",
    equipSlot: { $in: SET_SLOTS },
    name: { $regex: "秘銀|鋼鐵" },
    id: { $not: /^fire-/ },
  }).toArray();
  for (const it of stdItems) {
    if (!slotSet.has(it.equipSlot)) continue;
    if (!dry) await items.updateOne({ _id: it._id }, { $set: { setKey: "mithril", setName: "秘銀套裝", updatedAt: NOW } });
    mithril++;
  }
  console.log(`秘銀/鋼鐵 A 裝 → mithril：${mithril} 件`);
  console.log(`${dry ? "[DRY-RUN] " : ""}完成。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
