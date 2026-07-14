"use strict";
// 世界王寶箱「機率公開」說明產生器（依台灣扭蛋法，機率照開箱程式邏輯即時算）。
// 開箱=依掉落表 chance 權重抽一份(排除 gem-s-tier)；大史王另有先機/後勢傳說錨點各獨立骰。
// 用法：node scripts/regen-worldboss-chest-desc.js   （改過世界王掉落表後重跑即可同步說明）
require("dotenv").config();
const { MongoClient } = require("mongodb");

const CHESTS = [
  { chestId: "chest-daishi-king",   monsterId: "elite-daishi-king", anchors: [
      { name: "傳說錨點・驟先機之刃", pct: 3.0 }, { name: "傳說錨點・滯後勢之刃", pct: 2.9 },
    ] },
  { chestId: "chest-dragon-king",   monsterId: "dragon-king-boss", anchors: [] },
  { chestId: "chest-hellfang-king", monsterId: "0393acee-9851-4bcb-a8f5-fdb60a9968f1", anchors: [] },
];
const EXCLUDE = new Set(["gem-s-tier"]); // S 寶石只走實戰掉落、不進寶箱

function categorize(it) {
  if (!it) return "其他";
  if (it.itemType === "pet_egg") return "寵物蛋";
  if (/寶石|強化石/.test(it.name || "") || it.itemType === "gem") return `${it.tier || "?"} 階強化寶石`;
  if (it.itemType === "equipment") return `${it.tier || "?"} 階裝備`;
  if (it.itemType === "consumable") return "消耗品";
  return it.itemType || "其他";
}
// 分類排序：裝備(S>A>B>C>D) → 消耗品 → 寵物蛋 → 寶石；同群再依 % 大到小
const TIER_ORD = { S: 0, A: 1, B: 2, C: 3, D: 4 };
function catRank(label) {
  const m = label.match(/^([SABCD]) 階裝備$/); if (m) return [0, TIER_ORD[m[1]] ?? 9];
  if (label === "消耗品") return [1, 0];
  if (label === "寵物蛋") return [2, 0];
  if (/強化寶石$/.test(label)) return [3, 0];
  return [9, 0];
}

(async () => {
  const c = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000 });
  await c.connect();
  const db = c.db("equipmentGame");
  const items = new Map((await db.collection("items").find({}).toArray()).map((i) => [i.id, i]));
  for (const chest of CHESTS) {
    const mon = await db.collection("monsters").findOne({ id: chest.monsterId });
    if (!mon) { console.log(`⚠️ ${chest.chestId}: 找不到怪 ${chest.monsterId}`); continue; }
    const drops = (mon.drops || []).filter((d) => d && d.itemId && Number(d.chance) > 0 && !EXCLUDE.has(d.itemId));
    const total = drops.reduce((s, d) => s + Number(d.chance), 0);
    if (total <= 0) { console.log(`⚠️ ${chest.chestId}: 掉落池為空`); continue; }
    const anchorPct = chest.anchors.reduce((s, a) => s + a.pct, 0);
    const poolScale = (100 - anchorPct) / 100; // 錨點先獨立骰，剩餘比重進權重池
    const cat = {};
    for (const d of drops) { const k = categorize(items.get(d.itemId)); cat[k] = (cat[k] || 0) + Number(d.chance); }
    const rows = Object.entries(cat)
      .map(([k, v]) => ({ label: k, pct: Math.round((v / total) * poolScale * 1000) / 10 }))
      .filter((r) => r.pct > 0)
      .sort((a, b) => { const ra = catRank(a.label), rb = catRank(b.label); return ra[0] - rb[0] || ra[1] - rb[1] || b.pct - a.pct; });

    const lines = ["【隨機內容・機率公開】開啟後隨機獲得 1 項（機率四捨五入，合計約 100%）："];
    if (chest.anchors.length) {
      lines.push(chest.anchors.map((a) => `🌟 ${a.name} ${a.pct.toFixed(1)}%`).join("　"));
    }
    lines.push(rows.map((r) => `${r.label} ${r.pct.toFixed(1)}%`).join("｜"));
    lines.push(chest.anchors.length
      ? "※傳說錨點為全服唯一道具，已擁有者不會再開出，其機率併入其餘獎項。本商品無保底機制。"
      : "※本商品無保底機制。");
    const desc = lines.join("\n");
    await db.collection("items").updateOne({ id: chest.chestId }, { $set: { description: desc, updatedAt: new Date().toISOString() } });
    console.log(`✅ ${chest.chestId}\n${desc}\n`);
  }
  await c.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
