"use strict";
// 兵聖徽章（軍師二轉・A 分支）。
//
// 三件套——設定在 jobAdvancement、戰內在 combatLoop、計謀值在 sageGauge、知彼/教學相長在 route 層：
//   三十六計：計謀值 3 格（有攻擊的回合 +1），滿 → 隨機施展一計（火攻/落石/瞞天過海/連環/破釜沉舟）
//   知彼：圖鑑傷害加成 ×2（上限 15% → 30%）
//   教學相長：兵聖在區域內時，全區玩家圖鑑累積 ×2
//
// 被動與技能**沿用軍師徽章**。⚠️ 本季不開放：試煉任務 enabled:false。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_sage_t2_v1";
const BASE_BADGE_ID = "job_tactician_v1";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");
  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到軍師徽章 ${BASE_BADGE_ID}`);

  const doc = {
    id: BADGE_ID,
    name: "兵聖徽章",
    description: "他讀過的兵書比你打過的怪還多。開戰之前，這場仗他已經在心裡打完了三遍。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12；智略手（int 主、dex 輔）
    equipStats: { str: 0, agi: 3, vit: 0, int: 5, dex: 4, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    // 兵聖＝軍師的光環強化版（2026-07-23 使用者定案：輔助職走光環、不走個人破防/加傷）：
    // 隊伍 Boss 傷害 +5%→+10%、怪物防禦降低 5%→10%（INT 縮放疊加其上）
    passiveEffects: JSON.parse(JSON.stringify(base.passiveEffects || [])).map((e) => {
      if (e && e.target === "party" && (e.key === "party_boss_damage_up" || e.key === "party_monster_def_down")) {
        const v = Number(e.params?.value ?? e.value ?? 5) * 2;
        return { ...e, value: e.value != null ? v : e.value, params: { ...(e.params || {}), value: v }, notes: String(e.notes || "").replace(/5%?/, String(v) + "%") + "（兵聖強化）" };
      }
      return e;
    }),
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: JSON.parse(JSON.stringify(base.combatEffects || [])),
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 兵聖徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 兵聖徽章");
  }
  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用軍師被動 ${doc.passiveEffects.length} 條 / proc ${doc.procEffects.length} 條 / combat ${doc.combatEffects.length} 條`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name || s.key).join(" / ")}`);
  console.log("提醒：本季不開放，試煉任務為 enabled:false。");
  await client.close();
}
main().catch((err) => { console.error(err); process.exit(1); });
