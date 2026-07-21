"use strict";
// 聖劍士徽章（劍士二轉・A 分支）。設計文件：docs/JOB_T2_SWORDSMAN_HOLYBLADE.md
//
// 核心是「戰鬥姿態」：開打前選攻擊或防禦（設定在 src/shared/jobAdvancement.js 的 stances）。
// 被動與前兩個技能**沿用劍士徽章**——技能/被動是綁在徽章道具上的，
// 換了新徽章等於歸零，不沿用的話二轉會比一轉弱 30%（實測 33,347 vs 47,344）。
//
// ⚠️ 本季不開放：試煉任務建成 enabled:false，徽章只有靠任務才拿得到。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_holyblade_t2_v1";
const BASE_BADGE_ID = "job_swordsman_v1";

/** 聖劍士新增的兩個技能：綁定姿態，只有在對應姿態下才會進入隨機池 */
const NEW_SKILLS = [
  {
    key: "holyblade_pierce",
    name: "破魔一閃",
    description: "【攻擊姿態專屬】無視防禦+40%、ATK+20%，持續2回合。",
    cooldownTurns: 4,
    condition: { stance: "attack" },
    procEffects: [
      { key: "def_ignore", target: "self", params: { value: 40, duration: { mode: "turns", value: 2 } } },
      { key: "atk_up", target: "self", params: { value: 20, duration: { mode: "turns", value: 2 } } }
    ]
  },
  {
    key: "holyblade_bulwark",
    name: "聖盾壁壘",
    description: "【防禦姿態專屬】格擋率+15、受傷降低25%，持續3回合。",
    cooldownTurns: 4,
    condition: { stance: "defense" },
    procEffects: [
      { key: "block_chance_up", target: "self", params: { value: 15, duration: { mode: "turns", value: 3 } } },
      { key: "damage_reduction", target: "self", params: { value: 25, duration: { mode: "turns", value: 3 } } }
    ]
  }
];

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到劍士徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const doc = {
    id: BADGE_ID,
    name: "聖劍士徽章",
    description: "攻守之間，只在一念。出鞘則勢如破竹，持盾則寸步不讓。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12（一轉徽章是 7~8）——二轉的通用基準
    equipStats: { str: 5, agi: 0, vit: 5, int: 0, dex: 2, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    // 沿用劍士徽章的被動（含關鍵的 atk_multiplier_up 50：持劍時武器倍率 ×1.5）
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: [],
    // 沿用劍士的兩個技能 + 兩個姿態專屬新技能
    jobSkills: [
      ...JSON.parse(JSON.stringify(base.jobSkills || [])),
      ...NEW_SKILLS
    ],
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 聖劍士徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 聖劍士徽章");
  }

  console.log(`  沿用劍士被動 ${doc.passiveEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name).join(" / ")}`);
  console.log("提醒：本季不開放，試煉任務為 enabled:false，玩家無法取得。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
