"use strict";
/**
 * 把 10 把 S 階龍系武器加入「古龍王(B)」世界王掉落清單，低機率(每把 0.5%)。
 * 掉落為「每項各自獨立骰 chance%」，0.5% 比卡片(1%)、A 武器(1.56%)都低。
 * 冪等：先移除既有 s-dragon-* 掉落再加入，可重複執行/調整機率。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const BOSS_NAME = "古龍王(B)";
const CHANCE = 1.2; // 每把 S 武器掉落機率(%)：高於古龍王卡(1%)、略低於 A 武器(1.56%)
const S_WEAPONS = [
  ["s-dragon-sword_1h", "幼龍牙劍"],
  ["s-dragon-sword_2h", "龍脊巨劍"],
  ["s-dragon-mace_1h",  "龍顎戰錘"],
  ["s-dragon-mace_2h",  "龍骨碎天槌"],
  ["s-dragon-axe_1h",   "裂龍手斧"],
  ["s-dragon-axe_2h",   "屠龍巨斧"],
  ["s-dragon-dagger",   "龍鱗短刃"],
  ["s-dragon-staff_1h", "龍語法杖"],
  ["s-dragon-staff_2h", "龍脈長杖"],
  ["s-dragon-bow",      "龍筋獵弓"],
];

(async () => {
  const db = await getMongoDb();
  const m = await db.collection("monsters").findOne({ name: BOSS_NAME });
  if (!m) { console.error(`找不到 ${BOSS_NAME}`); process.exit(1); }

  const existing = Array.isArray(m.drops) ? m.drops : [];
  // 移除任何既有的 s-dragon-* 掉落(冪等)
  const cleaned = existing.filter((d) => !String(d.itemId || "").startsWith("s-dragon-"));
  const additions = S_WEAPONS.map(([itemId, itemName]) => ({ itemId, itemName, chance: CHANCE }));
  const nextDrops = [...cleaned, ...additions];

  await db.collection("monsters").updateOne(
    { _id: m._id },
    { $set: { drops: nextDrops, updatedAt: new Date().toISOString() } }
  );

  console.log(`${BOSS_NAME} 掉落:原 ${existing.length} 項 → 現 ${nextDrops.length} 項(加入 ${additions.length} 把 S 武器，各 ${CHANCE}%)`);
  for (const [id, name] of S_WEAPONS) console.log(`  + ${name} (${id}) ${CHANCE}%`);
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
