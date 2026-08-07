"use strict";
// 影舞者徽章（盜賊二轉・A 分支）。姊妹分支：毒尊（毒特化，尚未實作）。
//
// 核心是「連擊氣條」——規則在 src/shared/shadowGauge.js、戰鬥內邏輯在 combatLoop：
//   被動 · 連擊氣條：5 格；本回合有連擊 → +1 格（每回合最多 1）；
//                    滿 5 格 → 全部消耗 → 下一回合固定 5 連擊（殘影亂舞，該回合不累氣）；
//                    同場域跨場沿用（換區/10 分鐘沒打歸零）
//
// 被動與技能**沿用盜賊徽章**（匕首×1.2/毒 proc/連擊率+5/背刺/煙霧彈）——
// 技能綁在徽章道具上，換徽章等於歸零，不沿用會比一轉弱。
//
// ⚠️ 本季不開放：試煉任務 enabled:false，徽章只有靠任務才拿得到。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_shadowdancer_t2_v1";
const BASE_BADGE_ID = "job_rogue_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到盜賊徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const doc = {
    id: BADGE_ID,
    name: "影舞者徽章",
    description: "刀光追不上她的手，眼睛追不上她的刀。等你看清第一刀時，第五刀已經收回鞘裡。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12（二轉通用基準）；純敏捷手，與其他二轉區隔（聖劍士5/5/2、劍鬼7/3/2、狂戰7/4/1、矮人長3/7/2）
    equipStats: { str: 0, agi: 7, vit: 0, int: 0, dex: 3, luk: 2 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    // 沿用盜賊的被動（匕首×1.2/匕首+盾格擋/雙持連擊率+5）與 proc（毒）與 combat（高血上毒率+20）
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: JSON.parse(JSON.stringify(base.combatEffects || [])),
    // 沿用盜賊的兩個技能（背刺/煙霧彈）；連擊氣條不走 jobSkills
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 影舞者徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 影舞者徽章");
  }

  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用盜賊被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name).join(" / ")}`);
  console.log("  連擊氣條由 shadowGauge + combatLoop 提供，不在 jobSkills 內");
  console.log("提醒：本季不開放，試煉任務為 enabled:false，玩家無法取得。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
