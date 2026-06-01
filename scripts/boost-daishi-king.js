"use strict";
/**
 * 大史王強度 ×1.5（以原始數值為基準設絕對值，重跑安全/不會疊加）
 * 原始：str45 agi35 vit55 int33 dex45 luk30 def70 HP1.18M exp13000 gold27000
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const BOOSTED = {
  maxHp: 1770000,
  str: 68, agi: 53, vit: 83, int: 50, dex: 68, luk: 45,
  def: 105,
  expReward: 19500,
  goldReward: 40500,
  // defIgnorePct 維持 70（% 值不倍增）
  updatedAt: new Date().toISOString(),
};

async function main() {
  const db = await getMongoDb();
  const before = await db.collection("monsters").findOne({ id: "elite-daishi-king" });
  if (!before) { console.error("找不到大史王 (elite-daishi-king)"); process.exit(1); }
  await db.collection("monsters").updateOne({ id: "elite-daishi-king" }, { $set: BOOSTED });
  const after = await db.collection("monsters").findOne({ id: "elite-daishi-king" });
  const f = (m) => `Lv${m.level} HP${(m.maxHp / 1e4)}萬 str${m.str} agi${m.agi} vit${m.vit} int${m.int} dex${m.dex} luk${m.luk} def${m.def} exp${m.expReward} gold${m.goldReward}`;
  console.log("強化前:", f(before));
  console.log("強化後:", f(after), "(×1.5)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
