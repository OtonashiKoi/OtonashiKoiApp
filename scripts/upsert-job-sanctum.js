"use strict";
// 聖域師徽章（結界師二轉・A 分支）。
//
// 核心是「符文結界 → 共鳴反爆」——挨打本身就是蓄力，規則在 combatLoop：
//   結界＝maxHp×25% + INT×25，受傷先扣結界；吸收累積 ×2 反爆（無視防禦）
//   三個引爆時機：提前引爆（剛好收頭）/被打爆當回合/最後一回合滿額爆
//   聖域展開：出戰累積區域聖域值（4 格），滿 → 20 秒全區受傷減半＋每回合回血（sanctumGauge.js）
//
// 被動與技能**沿用結界師徽章**。⚠️ 本季不開放：試煉任務 enabled:false。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_sanctum_t2_v1";
const BASE_BADGE_ID = "job_barrier_mage_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");
  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到結界師徽章 ${BASE_BADGE_ID}`);

  const doc = {
    id: BADGE_ID,
    name: "聖域師徽章",
    description: "他從不揮劍，也從不後退。敵人的每一擊都刻進符文結界裡——等到結界盛不下那些傷痛的時候，就會連本帶利地還回去。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12；坦輔向（vit 主、int 撐結界厚度、agi 輔）
    equipStats: { str: 0, agi: 3, vit: 5, int: 4, dex: 0, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: JSON.parse(JSON.stringify(base.combatEffects || [])),
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 聖域師徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 聖域師徽章");
  }
  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用結界師被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("提醒：本季不開放，試煉任務為 enabled:false。");
  await client.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
