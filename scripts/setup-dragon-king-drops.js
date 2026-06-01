"use strict";
/**
 * 設定世界王「古龍王(B)」(dragon_king_lair) 掉落：
 *   - 照抄大史王掉落，機率 × 1.3（高一點）
 *   - 「大史王卡」換成「古龍王(B)卡」
 *   - 加「神秘龍蛋」@ 5%
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

const DK_MONSTER_ID = "dragon-king-boss";
const DK_CARD_ID = "monster-card-dragon-king";   // 古龍王(B)卡
const DK_CARD_NAME = "古龍王(B)卡";
const DASHI_CARD_NAME = "大史王卡";
const MYSTERY_EGG_ID = "14205225-0e0f-4d83-8908-5d24f781bd69";
const MYSTERY_EGG_NAME = "神秘龍蛋";
const CHANCE_MULT = 1.3;
const EGG_CHANCE = 5;

function round4(n) { return Math.round(n * 10000) / 10000; }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  const dashi = await db.collection("monsters").findOne({ name: "大史王" });
  if (!dashi) { console.error("找不到大史王"); process.exit(1); }
  const dk = await db.collection("monsters").findOne({ id: DK_MONSTER_ID });
  if (!dk) { console.error("找不到古龍王(B) (dragon-king-boss)"); process.exit(1); }

  // 照抄大史王掉落 × 1.3，卡片換成古龍王卡
  const drops = (dashi.drops || []).map((d) => {
    if (d.itemName === DASHI_CARD_NAME) {
      // 卡片維持固定 1%，不套機率倍率
      return { itemId: DK_CARD_ID, itemName: DK_CARD_NAME, chance: 1 };
    }
    return { itemId: d.itemId, itemName: d.itemName, chance: round4(d.chance * CHANCE_MULT) };
  });
  // 加神秘龍蛋
  if (!drops.some((d) => d.itemId === MYSTERY_EGG_ID)) {
    drops.push({ itemId: MYSTERY_EGG_ID, itemName: MYSTERY_EGG_NAME, chance: EGG_CHANCE });
  }

  console.log(`古龍王(B) 掉落設定（dryRun=${dryRun}）`);
  console.log(`  來源：大史王 ${dashi.drops.length} 項 × ${CHANCE_MULT} 倍`);
  console.log(`  卡片：${DASHI_CARD_NAME} → ${DK_CARD_NAME}（固定 1%，不套倍率）`);
  console.log(`  追加：${MYSTERY_EGG_NAME} @${EGG_CHANCE}%`);
  console.log(`  總掉落：${drops.length} 項`);
  console.log("─".repeat(70));
  // 列幾項代表
  drops.slice(0, 5).forEach((d) => console.log(`  ${d.itemName} @${d.chance}%`));
  console.log("  ...");
  const card = drops.find((d) => d.itemId === DK_CARD_ID);
  const egg = drops.find((d) => d.itemId === MYSTERY_EGG_ID);
  const gem = drops.find((d) => d.itemName === "A階寶石");
  console.log(`  ${card.itemName} @${card.chance}%（卡片）`);
  if (gem) console.log(`  ${gem.itemName} @${gem.chance}%`);
  console.log(`  ${egg.itemName} @${egg.chance}%`);

  if (!dryRun) {
    await db.collection("monsters").updateOne({ id: DK_MONSTER_ID }, { $set: { drops, updatedAt: NOW } });
  }
  console.log("─".repeat(70));
  console.log(`完成${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
