"use strict";
/**
 * 把所有怪物的 drops 裡「卡片」類掉落率統一設為 0.1%。
 * 只動卡片(itemId 指向 monsterCardOf/monsterCardSkill 的道具)；寶石/武器/素材不動。
 *
 *   node scripts/set-card-drop-rate.js --dry-run
 *   node scripts/set-card-drop-rate.js
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();
const RATE = 0.1;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  // 所有卡片 id 集合
  const cards = await db.collection("items")
    .find({ $or: [{ monsterCardOf: { $exists: true, $ne: null } }, { monsterCardSkill: { $exists: true, $ne: null } }] })
    .project({ id: 1 }).toArray();
  const cardIds = new Set(cards.map((c) => c.id));
  console.log(`卡片總數 ${cardIds.size}；掃描怪物 drops……\n` + "-".repeat(70));

  const monsters = await db.collection("monsters").find({ "drops.0": { $exists: true } }).toArray();
  let monstersChanged = 0, dropsChanged = 0;
  for (const m of monsters) {
    let changed = false;
    const drops = (m.drops || []).map((d) => {
      if (d && cardIds.has(d.itemId) && Number(d.chance) !== RATE) {
        console.log(`  ${(m.name || "?").padEnd(14)} ${d.itemName || d.itemId}  ${d.chance}% → ${RATE}%`);
        dropsChanged++; changed = true;
        return { ...d, chance: RATE };
      }
      return d;
    });
    if (changed) {
      monstersChanged++;
      if (!dryRun) await db.collection("monsters").updateOne({ _id: m._id }, { $set: { drops, updatedAt: NOW } });
    }
  }
  console.log("-".repeat(70));
  console.log(`${dryRun ? "[DRY-RUN] " : ""}改動：怪物 ${monstersChanged} 隻、卡片掉落 ${dropsChanged} 筆 → 全部 ${RATE}%`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
