"use strict";
/**
 * 移除大史王(elite-daishi-king)掉落表中的所有 B 階裝備（idempotent）。
 * 影響：基礎掉落 + 大史王寶箱都不再出現 B 階（寶箱讀同一張掉落表）。
 */
require("dotenv").config();

const BOSS_ID = "elite-daishi-king";

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const mon = await db.collection("monsters").findOne({ id: BOSS_ID });
  if (!mon) { console.error("找不到大史王"); process.exit(1); }

  const drops = Array.isArray(mon.drops) ? mon.drops : [];
  const items = await db.collection("items").find({ id: { $in: drops.map((d) => d.itemId) } }).toArray();
  const tierById = {};
  for (const it of items) tierById[it.id] = String(it.tier || "").toUpperCase();

  const removed = [];
  const kept = drops.filter((d) => {
    const tier = tierById[d.itemId] || "";
    if (tier === "B") { removed.push(d.itemName || d.itemId); return false; }
    return true;
  });

  if (!removed.length) {
    console.log("大史王掉落表已無 B 階,無需變更。");
  } else {
    await db.collection("monsters").updateOne({ id: BOSS_ID }, { $set: { drops: kept, updatedAt: new Date().toISOString() } });
    console.log(`已移除 ${removed.length} 種 B 階裝備：`);
    console.log("  " + removed.join("、"));
  }

  // 移除後的階級分佈
  const after = await db.collection("monsters").findOne({ id: BOSS_ID });
  const afterDrops = (after.drops || []).filter((d) => d && d.itemId && Number(d.chance) > 0);
  const items2 = await db.collection("items").find({ id: { $in: afterDrops.map((d) => d.itemId) } }).toArray();
  const t2 = {}; for (const it of items2) t2[it.id] = String(it.tier || "(無)").toUpperCase();
  const agg = {}; let total = 0;
  for (const d of afterDrops) { const t = t2[d.itemId] || "(無)"; agg[t] = (agg[t] || 0) + Number(d.chance); total += Number(d.chance); }
  const chestTotal = afterDrops.filter((d) => d.itemId !== "gem-s-tier").reduce((s, d) => s + Number(d.chance), 0);
  console.log(`\n移除後掉落表(${afterDrops.length} 種,權重 ${total.toFixed(2)})：`);
  for (const t of Object.keys(agg).sort()) {
    const chestW = t === "S" ? agg[t] - 15 : agg[t]; // 寶箱排除 S 寶石(權重15)
    console.log(`  ${t}階: 掉落權重 ${agg[t].toFixed(2)} | 寶箱機率 ${(Math.max(0, chestW) / chestTotal * 100).toFixed(1)}%`);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
