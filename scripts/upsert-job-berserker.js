"use strict";
// 狂戰士徽章（戰士二轉・A 分支）。姊妹分支：破軍（破甲，尚未設計定案）。
//
// 核心是「血量是燃料」——機制設定在 src/shared/jobAdvancement.js 的 warrior 分支：
//   被動 · 血怒     ：每缺 1% HP → ATK +1.2%，封頂 +60%（combatLoop 逐回合看當下 HP）
//   主動 · 血祭     ：開打前選擇，付當前 HP 30% 換整場 ATK +25%
//                     ⚠️ 刻意不帶吸血——實測帶 10% 吸血世界王 2.31x 直接爆表；
//                        血怒1.2+血祭25 實裝實測世界王 1.40x（聖劍士 1.50x 同線）
//   被動 · 戰意集氣 ：每打完一場 +1 格（存 progress.berserkGauge），
//                     集滿 5 格的下一場追加爆擊率 +30 後清空重集
//
// 被動與技能**沿用戰士徽章**——技能/被動綁在徽章道具上，換徽章等於歸零，
// 不沿用的話二轉會比一轉弱（聖劍士當時實測弱 30%）。
//
// ⚠️ 本季不開放：試煉任務 enabled:false，徽章只有靠任務才拿得到。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_berserker_t2_v1";
const BASE_BADGE_ID = "job_warrior_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到戰士徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const doc = {
    id: BADGE_ID,
    name: "狂戰士徽章",
    description: "痛楚不是警訊，是柴薪。血流得越多，斧刃燒得越紅——直到戰意炸裂的那一刻。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12（二轉通用基準）；偏攻＋一點體力，與聖劍士 str5/vit5/dex2、劍鬼 str7/vit3/dex2 區隔
    equipStats: { str: 7, agi: 0, vit: 4, int: 0, dex: 0, luk: 1 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    // 沿用戰士徽章的被動（含關鍵的 atk_multiplier_up 50：持斧時武器倍率 ×1.5）
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: [],
    // 沿用戰士的兩個技能（踢到桌腳很生氣／死亡意志）；血怒/血祭/集氣不走 jobSkills
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 狂戰士徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 狂戰士徽章");
  }

  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用戰士被動 ${doc.passiveEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name).join(" / ")}`);
  console.log("  血怒／血祭／戰意集氣由 jobAdvancement + berserkGauge 提供，不在 jobSkills 內");
  console.log("提醒：本季不開放，試煉任務為 enabled:false，玩家無法取得。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
