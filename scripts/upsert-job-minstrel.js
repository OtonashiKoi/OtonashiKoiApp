"use strict";
// 吟遊詩人徽章（詩人二轉・A 分支）。
//
// 核心是「演奏判定」——全遊戲第一個動作輸入玩法，規則在 src/shared/bardSong.js：
//   出戰時 5 個方向箭頭、3 秒內輸入（鍵盤/滑動）；對 +6%/錯 -6%、完美連奏每層 +10%（上限5）
//   完美另觸發「完美和弦」開場追擊；連奏同區跨場沿用；DC 無演奏
//
// 被動與技能**沿用詩人徽章**。⚠️ 本季不開放：試煉任務 enabled:false。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_minstrel_t2_v1";
const BASE_BADGE_ID = "job_bard_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");
  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到詩人徽章 ${BASE_BADGE_ID}`);

  const doc = {
    id: BADGE_ID,
    name: "吟遊詩人徽章",
    description: "琴聲即劍聲。她的每一個音符都踩在戰場的節拍上——彈錯一個音，代價是血；彈對整段，敵人為她謝幕。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12；節奏手（dex 主、agi/luk 輔）
    equipStats: { str: 0, agi: 4, vit: 0, int: 0, dex: 5, luk: 3 },
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
    console.log("已更新 吟遊詩人徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 吟遊詩人徽章");
  }
  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用詩人被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("提醒：本季不開放，試煉任務為 enabled:false。");
  await client.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
