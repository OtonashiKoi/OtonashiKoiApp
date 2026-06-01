// 探測：怪物金幣相關欄位現況（決定 ÷10 怎麼除）
require("dotenv").config();
const { MongoClient } = require("mongodb");
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const mons = await db.collection("monsters").find({}).toArray();

  let goldField = 0, partField = 0, both = 0;
  let minGold = Infinity, maxGold = -Infinity;
  for (const m of mons) {
    const g = Number(m.goldReward || 0);
    const p = Number(m.participantGoldReward || 0);
    if (g > 0) { goldField++; minGold = Math.min(minGold, g); maxGold = Math.max(maxGold, g); }
    if (p > 0) partField++;
    if (g > 0 && p > 0) both++;
  }
  console.log(`怪物總數：${mons.length}`);
  console.log(`有 goldReward>0：${goldField}（範圍 ${minGold}~${maxGold}）`);
  console.log(`有 participantGoldReward>0：${partField}`);
  console.log(`兩者皆有：${both}`);
  console.log("\n÷10 後最低金幣會變：", Math.round(minGold / 10), "（若 <1 需設下限）");

  // 列幾隻範例
  console.log("\n範例：");
  for (const m of mons.filter((x) => x.goldReward).slice(0, 6)) {
    console.log(`  ${m.name}(${m.zone}) gold=${m.goldReward} part=${m.participantGoldReward || "-"}`);
  }
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
