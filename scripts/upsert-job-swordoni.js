"use strict";
// 劍鬼徽章（劍士二轉・B 分支）。姊妹分支：聖劍士（姿態切換）。
//
// 核心是「區域連段（COMBO）」——規則與階梯加成在 src/shared/zoneCombo.js：
//   被動 · 連段階梯：攻擊力/吸血/爆擊率/爆擊傷害，兩輪制，99 段吃滿
//   被動 · 不屈    ：第一次陣亡連段減半，連續第二次才歸零（贏一場就重置保護）
//   主動 · 斬      ：連段 ≥30 可消耗全部連段，第 1 回合打出
//                    「無視防禦與等級差」的一擊（仍可爆擊）
//
// 被動與前兩個技能**沿用劍士徽章**——技能/被動綁在徽章道具上，換徽章等於歸零，
// 不沿用的話二轉會比一轉弱（聖劍士實測弱 30%）。
//
// ⚠️ 本季不開放：試煉任務 enabled:false，徽章只有靠任務才拿得到。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_swordoni_t2_v1";
const BASE_BADGE_ID = "job_swordsman_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到劍士徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const doc = {
    id: BADGE_ID,
    name: "劍鬼徽章",
    description: "刀鋒記得每一次揮砍。連得越久，斬得越深——直到那一刀落下，什麼也擋不住。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12（二轉通用基準）；偏攻擊，與聖劍士的 str5/vit5/dex2 做出區隔
    equipStats: { str: 7, agi: 0, vit: 3, int: 0, dex: 2, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    // 沿用劍士徽章的被動（含關鍵的 atk_multiplier_up 50：持劍時武器倍率 ×1.5）
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: [],
    // 沿用劍士的兩個技能；連段相關的能力不走 jobSkills，走 zoneCombo 系統
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 劍鬼徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 劍鬼徽章");
  }

  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用劍士被動 ${doc.passiveEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name).join(" / ")}`);
  console.log("  連段能力（階梯加成／不屈／斬）由 zoneCombo 系統提供，不在 jobSkills 內");
  console.log("提醒：本季不開放，試煉任務為 enabled:false，玩家無法取得。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
