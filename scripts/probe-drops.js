// 探測：怪物 drops 結構 + 各區掉落的裝備，估「身上裝備長怎樣」
require("dotenv").config();
const { MongoClient } = require("mongodb");
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const m = await db.collection("monsters").findOne({ "drops.0": { $exists: true } });
  console.log("=== 一隻怪的 drops 範例 ===");
  console.log("怪：", m.name, "zone:", m.zone, "lv:", m.level);
  console.log(JSON.stringify(m.drops, null, 2).slice(0, 1500));

  // 一件裝備道具的欄位
  const eq = await db.collection("items").findOne({ itemType: "equipment", equipSlot: { $ne: "special" } });
  console.log("\n=== 一件裝備道具欄位 ===");
  console.log(Object.keys(eq).join(", "));
  console.log("  name:", eq.name, "slot:", eq.equipSlot, "tier:", eq.tier, "rarity:", eq.rarity, "sellValue:", eq.sellValue);
  console.log("  equipStats:", JSON.stringify(eq.equipStats));

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
