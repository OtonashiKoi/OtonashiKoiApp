// 驗證：套用新曲線(×10)+金幣÷10 後，1→50 的時間/金幣/掉落
// 直接讀 progression.js 與 DB 現值，不套任何試算倍率
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { expToNextLevel, MAX_LEVEL } = require("../src/shared/progression");
const { ZONE_BY_KEY } = require("../src/shared/zones");
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";

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
  const items = await db.collection("items").find({}).toArray();
  const itemById = new Map(items.map((it) => [it.id, it]));
  await client.close();

  const isCard = (it) => it && (it.itemType === "monster_card" || it.monsterCardOf || /^special/.test(String(it.equipSlot || "")));
  const isEquip = (it) => it && it.itemType === "equipment" && !isCard(it);

  function poolForLevel(L) {
    const eligible = mons.filter((m) => m.level <= L);
    if (eligible.length === 0) return [mons.reduce((a, b) => (a.level < b.level ? a : b))];
    const maxLv = Math.max(...eligible.map((m) => m.level));
    return eligible.filter((m) => m.level >= maxLv - 1);
  }
  const avg = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;

  let kills = 0, gold = 0, secs = 0, equipDrops = 0, cardDrops = 0;
  const tierDrops = {}, segGold = {}, segKills = {};
  for (let L = 1; L < MAX_LEVEL; L++) {
    const need = expToNextLevel(L);
    const pool = poolForLevel(L);
    const k = need / avg(pool, (m) => m.expReward);
    kills += k;
    gold += k * avg(pool, (m) => m.goldReward || 0);
    const agi = Math.min(35, 5 + L * 0.7);
    secs += k * (battleSecs(agi) + 15);

    let pe = 0, pc = 0; const pt = {};
    for (const m of pool) for (const d of (m.drops || [])) {
      const it = itemById.get(d.itemId); const p = (d.chance || 0) / 100;
      if (isCard(it)) pc += p;
      else if (isEquip(it)) { pe += p; const t = String(it.tier || "?").toUpperCase(); pt[t] = (pt[t] || 0) + p; }
    }
    equipDrops += k * (pe / pool.length); cardDrops += k * (pc / pool.length);
    for (const [t, v] of Object.entries(pt)) tierDrops[t] = (tierDrops[t] || 0) + k * (v / pool.length / pool.length);
    const z = pool[0].zone || "?";
    segGold[z] = (segGold[z] || 0) + k * avg(pool, (m) => m.goldReward || 0);
    segKills[z] = (segKills[z] || 0) + k;
  }

  const hr = secs / 3600;
  console.log("======== 套用後驗證：1 → 50 ========\n");
  console.log(`總擊殺：約 ${Math.round(kills).toLocaleString()} 隻`);
  console.log(`總時間：約 ${hr.toFixed(1)} 小時（含每場 +15s 操作/找怪）`);
  console.log(`  每天 1hr → ${Math.ceil(hr)} 天 ／ 2hr → ${Math.ceil(hr / 2)} 天 ／ 3hr → ${Math.ceil(hr / 3)} 天`);
  console.log(`總金幣：約 ${Math.round(gold).toLocaleString()} 金`);
  console.log(`掉落裝備：約 ${Math.round(equipDrops).toLocaleString()} 件　掉落卡片：約 ${Math.round(cardDrops)} 張`);
  console.log("\n各區金幣分段：");
  for (const z of Object.keys(segGold)) {
    console.log(`  ${ZONE_BY_KEY[z]?.label || z}：${Math.round(segKills[z])} 隻、${Math.round(segGold[z]).toLocaleString()} 金`);
  }
  console.log("\n抽查升等需求（新曲線）：");
  for (const L of [1, 10, 20, 30, 40, 49]) console.log(`  Lv${L}→${L + 1}：${expToNextLevel(L).toLocaleString()} exp`);
})().catch((e) => { console.error(e); process.exit(1); });
