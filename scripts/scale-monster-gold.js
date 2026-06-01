// 怪物金幣整體倍率調整。
// 目前正式目標：Lv1→50 約 30 小時，金幣產出約提高 3 倍。
// 安全措施：先把原值存進 goldReward_pre_scale3 / participantGoldReward_pre_scale3（僅首次），可回溯。
// 用法：
//   node scripts/scale-monster-gold.js                  -> dry-run，只印不寫，預設 ×3
//   node scripts/scale-monster-gold.js --apply          -> 實際寫入，預設 ×3
//   SCALE=2 node scripts/scale-monster-gold.js --apply  -> 改用指定倍率
require("dotenv").config();
const { MongoClient } = require("mongodb");
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";
const APPLY = process.argv.includes("--apply");
const SCALE = Number(process.env.SCALE || 3);

if (!Number.isFinite(SCALE) || SCALE <= 0) {
  console.error("SCALE must be a positive number.");
  process.exit(1);
}

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection("monsters");
  const mons = await col.find({}).toArray();

  let changed = 0;
  for (const m of mons) {
    const set = {};
    const g = Number(m.goldReward || 0);
    const p = Number(m.participantGoldReward || 0);
    if (g > 0) {
      if (m.goldReward_pre_scale3 === undefined) set.goldReward_pre_scale3 = g;
      set.goldReward = Math.max(1, Math.round(g * SCALE));
    }
    if (p > 0) {
      if (m.participantGoldReward_pre_scale3 === undefined) set.participantGoldReward_pre_scale3 = p;
      set.participantGoldReward = Math.max(1, Math.round(p * SCALE));
    }
    if (Object.keys(set).length === 0) continue;
    changed++;
    if (changed <= 8) {
      console.log(`  ${m.name}(${m.zone}) gold ${g}→${set.goldReward ?? g}` +
        (p ? `  part ${p}→${set.participantGoldReward}` : ""));
    }
    if (APPLY) await col.updateOne({ _id: m._id }, { $set: set });
  }

  console.log(`\n${APPLY ? "已寫入" : "DRY-RUN（未寫入）"}：${changed} 隻怪物金幣 ×${SCALE}`);
  if (!APPLY) console.log("確認無誤後加 --apply 實際執行。");
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
