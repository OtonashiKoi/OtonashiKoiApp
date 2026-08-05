"use strict";
// 元素師徽章（法師二轉・A 分支）。
//
// 核心是「場地魔法三姿態」——設定在 jobAdvancement、戰內邏輯在 combatLoop、冰凍值在 zoneFreezeGauge：
//   🔥 炎圈：怪物每回合受到 MATK×10% 火傷（世界王所有部位一起燒）；攻擊帶火屬性 2 級
//   🌩️ 嵐暴：每回合固定 3 段法術彈（每段 70%、各段獨立爆擊；無視連擊/三元/骰子多段）＝預設姿態
//   ❄️ 凍霜：出戰累積區域冰凍值，滿 300 → 區域冰封 20 秒全員免傷；攻擊帶水屬性 2 級
//   姿態屬性與武器屬性：同屬性等級相加（封頂4）、不同屬性取最高
//
// 被動與技能**沿用法師徽章**——技能綁在徽章道具上，換徽章等於歸零，不沿用會比一轉弱。
// ⚠️ 本季不開放：試煉任務 enabled:false，徽章只有靠任務才拿得到。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_elementalist_t2_v1";
const BASE_BADGE_ID = "job_mage_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到法師徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const doc = {
    id: BADGE_ID,
    name: "元素師徽章",
    description: "火焰聽她的、寒霜聽她的、風暴也聽她的。戰場不是她的敵人——是她的樂器。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12（二轉通用基準）；主智力（聖劍士5/5/2、劍鬼7/3/2、狂戰7/4/1、矮人長3/7/2、影舞者7/3/2）
    equipStats: { str: 0, agi: 0, vit: 3, int: 7, dex: 2, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    // 沿用法師的被動／proc／combat 與技能；三姿態不走 jobSkills
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
    console.log("已更新 元素師徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 元素師徽章");
  }

  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用法師被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("  三姿態由 jobAdvancement + combatLoop + zoneFreezeGauge 提供，不在 jobSkills 內");
  console.log("提醒：本季不開放，試煉任務為 enabled:false，玩家無法取得。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
