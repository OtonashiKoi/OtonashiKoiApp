"use strict";
// 賭神徽章（賭徒二轉・A 分支）＋賭徒技能綁定骰子武器。
//
// 賭神三件套（規則在 combatLoop / diceGauge.js）：
//   魔法骰：骰子傷害視為魔法（常駐無視 25% DEF，武器層 combatStats）
//   命運骰：6 格集氣，滿的那回合改丟 3 顆——第三顆骰出 N ＝ 當回合 N 連擊
//   手氣正旺：兩骰平均 >3 疊層（每層 +2%、上限 25）、<3 歸零；全域跨場
//
// 另依使用者定案：賭徒（T1+T2）技能一律綁骰子武器（condition.weaponType）。
// ⚠️ 賭徒線本季封存：試煉任務 enabled:false。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_dicegod_t2_v1";
const BASE_BADGE_ID = "job_gambler_v1";

function bindSkillsToDice(skills) {
  return JSON.parse(JSON.stringify(skills || [])).map((sk) => ({
    ...sk,
    condition: { ...(sk.condition || {}), weaponType: "dice" },
  }));
}

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");
  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到賭徒徽章 ${BASE_BADGE_ID}`);

  // ── T1 賭徒：技能補上骰子綁定（引擎已支援 condition.weaponType 判定）──
  const t1Skills = bindSkillsToDice(base.jobSkills);
  await items.updateOne({ id: BASE_BADGE_ID }, { $set: { jobSkills: t1Skills, updatedAt: new Date().toISOString() } });
  console.log(`已更新 賭徒徽章技能綁定骰子（${t1Skills.map((s) => s.name).join(" / ")}）`);

  const doc = {
    id: BADGE_ID,
    name: "賭神徽章",
    description: "他把整條命放上賭桌，然後笑著告訴你：莊家從來就不是靠運氣贏的——是靠你以為這只是運氣。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12；LUK 主（爆擊/擲骰階級/手氣本命），agi/dex 輔
    equipStats: { str: 0, agi: 4, vit: 0, int: 0, dex: 3, luk: 5 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: JSON.parse(JSON.stringify(base.combatEffects || [])),
    jobSkills: bindSkillsToDice(base.jobSkills),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 賭神徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 賭神徽章");
  }
  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用賭徒被動 ${doc.passiveEffects.length} 條；技能 ${doc.jobSkills.length} 個（已綁骰子）：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("提醒：賭徒線本季封存，試煉任務為 enabled:false。");
  await client.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
