"use strict";
// 聖靈師徽章（治療師二轉・A 分支）。
//
// 核心是「日之精靈」——持久化在 src/shared/sunSpirit.js、戰內邏輯在 combatLoop：
//   召喚：開場自動；精靈血量＝主人 maxHp，不套用主人任何防禦效果；怪物攻擊先打精靈
//   協攻：每回合一擊，ATK＝主人 33%、日屬性 3 級（單發不爆擊不連擊）
//   光環：精靈在場 → 給隊伍的光環效果 ×2（route 層快照）
//   大治療術：每 5 個有出手的回合回復 maxHp 30%＋INT 補正（先精靈後自己；聖人錨點下全數轉傷）
//   跨場沿用（同區）；倒下 → 下一場 50% 血量重召
//
// 被動與技能**沿用治療師徽章**——技能綁在徽章道具上，不沿用會比一轉弱。
// ⚠️ 本季不開放：試煉任務 enabled:false。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_spiritmaster_t2_v1";
const BASE_BADGE_ID = "job_healer_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到治療師徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const doc = {
    id: BADGE_ID,
    name: "聖靈師徽章",
    description: "她從不獨行。晨光所至之處，總有一縷小小的日輝先她一步，替她擋下所有黑暗。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12；雙屬性體質（聖5/5/2、劍鬼7/3/2、狂戰7/4/1、矮人長3/7/2、影7/3/2、元素0/3+7/2）
    equipStats: { str: 0, agi: 0, vit: 5, int: 5, dex: 2, luk: 0 },
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
    console.log("已更新 聖靈師徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 聖靈師徽章");
  }
  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用治療師被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("  日之精靈由 sunSpirit + combatLoop 提供，不在 jobSkills 內");
  console.log("提醒：本季不開放，試煉任務為 enabled:false。");
  await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
