"use strict";
/**
 * 給 dragon_realm 所有怪物加入「A 階寶石」掉落，機率 2%
 * 若已有就更新 chance；沒有就新增。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const STONE_ID   = "a6ae293d-52fc-4af5-8770-891ddf842e35";
const STONE_NAME = "A階寶石";
const CHANCE = 2;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = await db.collection("monsters").find({ zone: "dragon_realm" }).toArray();
  console.log(`dragon_realm 怪物 ${ms.length} 隻（dryRun=${dryRun}）`);
  console.log("─".repeat(80));

  let added = 0, updated = 0;
  for (const m of ms) {
    const drops = Array.isArray(m.drops) ? [...m.drops] : [];
    const idx = drops.findIndex((d) => d.itemId === STONE_ID);
    const newEntry = { itemId: STONE_ID, itemName: STONE_NAME, chance: CHANCE };

    if (idx >= 0) {
      const oldChance = drops[idx].chance;
      if (oldChance === CHANCE) {
        console.log(`UNCHANGED Lv.${String(m.level).padEnd(3)} ${m.name.padEnd(16)} 已有 ${STONE_NAME}@${oldChance}%`);
        continue;
      }
      drops[idx] = newEntry;
      console.log(`UPDATE    Lv.${String(m.level).padEnd(3)} ${m.name.padEnd(16)} ${STONE_NAME} ${oldChance}% → ${CHANCE}%`);
      updated++;
    } else {
      drops.push(newEntry);
      console.log(`ADD       Lv.${String(m.level).padEnd(3)} ${m.name.padEnd(16)} + ${STONE_NAME}@${CHANCE}%（總 drops ${drops.length} 件）`);
      added++;
    }
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: { drops } });
    }
  }
  console.log("─".repeat(80));
  console.log(`完成：新增 ${added} / 更新 ${updated}${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
