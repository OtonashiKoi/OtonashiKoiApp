// 估算 1->40：幾天、多少錢、身上裝備長怎樣
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { expToNextLevel } = require("../src/shared/progression");
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";

// 一場戰鬥的系統最短耗時（tickDelay * 15回合），不含玩家操作/看戰報時間
function battleSecs(agi) {
  const base = 1500, min = 500, cap = 40;
  const a = Math.min(Math.max(1, agi), cap);
  const tick = Math.round(base - ((a - 1) / (cap - 1)) * (base - min));
  return (tick * 15) / 1000;
}

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const monsters = await db.collection("monsters")
    .find({ enabled: { $ne: false }, isBoss: { $ne: true } }).toArray();
  const mons = monsters.filter((m) => (m.level || 0) > 0 && (m.expReward || 0) > 0);

  function poolForLevel(L) {
    const eligible = mons.filter((m) => m.level <= L);
    if (eligible.length === 0) return [mons.reduce((a, b) => (a.level < b.level ? a : b))];
    const maxLv = Math.max(...eligible.map((m) => m.level));
    return eligible.filter((m) => m.level >= maxLv - 1);
  }
  const avg = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;

  let totalGold = 0, totalKills = 0, totalSecsFast = 0, totalSecsSlow = 0;
  const seg = {};
  for (let L = 1; L < 40; L++) {
    const need = expToNextLevel(L);
    const pool = poolForLevel(L);
    const kills = need / avg(pool, (m) => m.expReward);
    totalGold += kills * avg(pool, (m) => m.goldReward || 0);
    totalKills += kills;
    // 玩家 agi 粗估：隨等級成長，低等 agi~5、高等 agi~30
    const agi = Math.min(35, 5 + L * 0.7);
    totalSecsFast += kills * battleSecs(agi);          // 純系統時間
    totalSecsSlow += kills * (battleSecs(agi) + 15);   // +15s 玩家操作/看戰報/找怪
    const band = L < 10 ? "Lv1-10" : L < 20 ? "Lv10-20" : L < 30 ? "Lv20-30" : "Lv30-40";
    seg[band] = (seg[band] || 0) + kills * avg(pool, (m) => m.goldReward || 0);
  }

  console.log("===== 1 -> 40 純打怪估算 =====");
  console.log(`總擊殺：約 ${Math.round(totalKills)} 隻`);
  console.log(`總金幣：約 ${Math.round(totalGold).toLocaleString()} 金`);
  console.log("\n分段金幣：");
  for (const [b, g] of Object.entries(seg)) console.log(`  ${b}: ${Math.round(g).toLocaleString()}`);

  console.log("\n--- 純戰鬥時間（系統最短）---");
  console.log(`  約 ${(totalSecsFast / 3600).toFixed(1)} 小時`);
  console.log("--- 含操作/找怪（每場+15s）---");
  const hrSlow = totalSecsSlow / 3600;
  console.log(`  約 ${hrSlow.toFixed(1)} 小時`);
  console.log(`  每天玩 1 小時 -> 約 ${Math.ceil(hrSlow / 1)} 天`);
  console.log(`  每天玩 2 小時 -> 約 ${Math.ceil(hrSlow / 2)} 天`);
  console.log(`  每天玩 3 小時 -> 約 ${Math.ceil(hrSlow / 3)} 天`);

  // ── 身上裝備：Lv40 玩家會打古城深處，看那區掉的裝備 tier 分佈 ──
  console.log("\n===== Lv40 身上裝備推估（古城深處掉落）=====");
  const deepMons = mons.filter((m) => m.zone === "ancient_city_deep");
  const dropItemIds = new Set();
  for (const m of deepMons) for (const d of (m.drops || [])) dropItemIds.add(d.itemId);
  const items = await db.collection("items")
    .find({ id: { $in: [...dropItemIds] }, itemType: "equipment", equipSlot: { $ne: "special" } }).toArray();
  const tierBySlot = {};
  for (const it of items) {
    const slot = it.equipSlot || "?";
    if (!tierBySlot[slot]) tierBySlot[slot] = new Set();
    tierBySlot[slot].add(it.tier || "?");
  }
  for (const [slot, tiers] of Object.entries(tierBySlot)) {
    console.log(`  ${slot}: tier ${[...tiers].join("/")}`);
  }

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
