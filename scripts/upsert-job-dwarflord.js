"use strict";
// 矮人戰士長徽章（矮人戰士二轉・A 分支）。姊妹分支：符文守衛（反傷坦，尚未設計）。
//
// 核心是「巨神震擊」——全遊戲第一個**團隊開關型**機制，規則在 src/shared/dwarfStunGauge.js：
//   只有這個徽章敲得動世界王的暈眩條（敲擊量＝該場實際有攻擊到的回合數），
//   敲滿 300 → 全服共享 20 秒暈眩窗口，期間**任何人**出戰都整場免傷，之後 2 分鐘免疫。
//   世界王／單人世界王都有（單人王＝世界王簡化版）。
//
// 被動與技能**沿用矮人戰士徽章**——技能/被動綁在徽章道具上，換徽章等於歸零。
//
// ⚠️ 順手補一轉的坑：矮人戰士的 atk_multiplier_up 只有 **20**（×1.2），
//    而劍士/戰士都是 50（×1.5）——輸出直接矮人家 25%，這是它全服 0 人裝備的主因。
//    二轉版拉到 40（×1.4）：仍低於純輸出職業（坦的代價還在），但不再是懲罰性的差距。
//
// ⚠️ 本季不開放：試煉任務 enabled:false，徽章只有靠任務才拿得到。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_dwarflord_t2_v1";
const BASE_BADGE_ID = "job_dwarf_warrior_v1";

/** 二轉把武器倍率被動從 20 拉到 40（一轉維持 20 不動，避免影響線上平衡） */
const T2_ATK_MULTIPLIER = 40;

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const base = await items.findOne({ id: BASE_BADGE_ID });
  if (!base) throw new Error(`找不到矮人戰士徽章 ${BASE_BADGE_ID}，無法沿用被動與技能`);

  const passiveEffects = JSON.parse(JSON.stringify(base.passiveEffects || []));
  for (const p of passiveEffects) {
    if (p && p.key === "atk_multiplier_up") {
      p.params = { ...(p.params || {}), value: T2_ATK_MULTIPLIER };
      p.notes = String(p.notes || "").replace(/x1\.2/g, "x1.4");
    }
  }

  const doc = {
    id: BADGE_ID,
    name: "矮人戰士長徽章",
    description: "山的重量壓在肩上，槌落之處連巨獸也得跪下。他倒下的那二十秒，是全軍的機會。",
    itemType: "job_badge",
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [],
    equipSlot: "job_eq",
    // 總和 12（二轉通用基準）；偏坦，與聖劍士 str5/vit5/dex2、劍鬼 str7/vit3/dex2、狂戰 str7/vit4/luk1 區隔
    equipStats: { str: 3, agi: 0, vit: 7, int: 0, dex: 2, luk: 0 },
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    tier: null,
    enhanceLevel: 0,
    passiveEffects,
    procEffects: JSON.parse(JSON.stringify(base.procEffects || [])),
    combatEffects: [],
    // 沿用矮人戰士的兩個技能（鐵壁／震地重擊）；巨神震擊不走 jobSkills
    jobSkills: JSON.parse(JSON.stringify(base.jobSkills || [])),
  };

  const existing = await items.findOne({ id: BADGE_ID });
  if (existing) {
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: BADGE_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 矮人戰士長徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 矮人戰士長徽章");
  }

  console.log(`  屬性：${JSON.stringify(doc.equipStats)}（總和 12）`);
  console.log(`  沿用矮人戰士被動 ${passiveEffects.length} 條；武器倍率被動 20 → ${T2_ATK_MULTIPLIER}`);
  console.log(`  技能 ${doc.jobSkills.length} 個：${doc.jobSkills.map((s) => s.name).join(" / ")}`);
  console.log("  巨神震擊（世界王暈眩條）由 dwarfStunGauge 提供，不在 jobSkills 內");
  console.log("提醒：本季不開放，試煉任務為 enabled:false，玩家無法取得。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
