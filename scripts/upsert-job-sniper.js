"use strict";
// 神射手徽章（弓箭手二轉・A 分支）。
//
// 三件套——設定在 jobAdvancement、戰內在 combatLoop、震盪值在 sniperGauge、掩護射擊在 route 層光環管線：
//   掩護射擊：區內其他玩家出戰時每回合補一箭（ATK 50%、吃自己爆擊；世界王歸戶貢獻）
//   神速反擊：這回合對手沒打到你（含硬控回合）→ 追加一箭 ATK 100%
//   震盪射擊：震盪值 4 格（有攻擊的回合 +1），滿 → 立刻一箭＋震退（下回合對手構不到你）
//
// 被動與技能**沿用弓箭手徽章**。⚠️ 本季不開放：試煉任務 enabled:false。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_sniper_t2_v1";
const BASE_BADGE_ID = "job_archer_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");
  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到弓箭手徽章 ${BASE_BADGE_ID}`);

  const doc = {
    id: BADGE_ID,
    name: "神射手徽章",
    description: "戰場上看不到他的身影，只看得到落在每個戰友身邊的箭。他不在前線——他在所有人的背後。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12；精準手（dex 主）
    equipStats: { str: 2, agi: 3, vit: 0, int: 0, dex: 7, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    passiveEffects: [
      ...JSON.parse(JSON.stringify(base.passiveEffects || [])),
      // 神射手專屬（2026-07-23 使用者定案）：狙擊精準——爆擊率 +20
      // 弓是唯一無攻擊向特性的主戰武器（斧=破甲15+爆擊20、杖=破防25、弓=只有閃避20），
      // 補在二轉徽章而非武器層（使用者決定：不讓一轉全線吃到）
      { key: "crit_rate_up", target: "self", trigger: "passive", chance: 100, params: { value: 20 }, notes: "狙擊精準：爆擊率 +20" },
    ],
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: JSON.parse(JSON.stringify(base.combatEffects || [])),
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 神射手徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 神射手徽章");
  }
  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用弓箭手被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("提醒：本季不開放，試煉任務為 enabled:false。");
  await client.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
