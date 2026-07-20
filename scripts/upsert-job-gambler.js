"use strict";
// 賭徒徽章（第 11 個一轉職業）。
// 設計依據：docs/JOB_GAMBLER_DESIGN.md
// 主動技能不在這裡設定，統一由 scripts/write_job_skills.js 寫入。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const JOB_ITEM_ID = "job_gambler_v1";

function passive(key, value, notes, condition = null) {
  const effect = {
    key,
    trigger: "passive",
    target: "self",
    chance: 100,
    stacks: 1,
    stackMode: "replace",
    duration: { mode: "battle", value: 1 },
    params: { value },
    notes,
  };
  if (condition) effect.condition = condition;
  return effect;
}

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "賭徒徽章",
  description: "以命運為武器的人。LUK 決定一切——傷害、爆擊、閃避，甚至你今天的運氣。",
  itemType: "job_badge",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipSlot: "job_eq",
  // 總和 8，對齊既有職業徽章量級
  equipStats: { str: 0, agi: 2, vit: 0, int: 0, dex: 1, luk: 5 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: null,
  enhanceLevel: 0,
  passiveEffects: [
    // 持骰子才生效：鼓勵使用本職武器
    passive("crit_rate_up", 10, "持骰子：爆擊率 +10%", { weaponType: "dice" }),
    passive("crit_damage_up", 20, "持骰子：爆擊傷害 +20%", { weaponType: "dice" }),
    // 無條件生效：讓玩家可以先轉職、之後再慢慢湊骰子
    passive("gold_gain_up", 15, "金幣獲得 +15%"),
    passive("rare_drop_rate_up", 5, "稀有掉落率 +5%"),
  ],
  procEffects: [
    {
      key: "proc_extra_hit",
      trigger: "on_attack",
      target: "enemy",
      chance: 15,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 100 },
      condition: { weaponType: "dice" },
      notes: "再擲一次：15% 機率追加一擊",
    },
  ],
  combatEffects: [],
};

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const existing = await items.findOne({ id: JOB_ITEM_ID });
  const doc = { ...JOB_ITEM };
  if (existing) {
    // 保留使用者可能已經補上的圖
    if (existing.imageUrl) delete doc.imageUrl;
    if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
    await items.updateOne({ id: JOB_ITEM_ID }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
    console.log("已更新 賭徒徽章");
  } else {
    await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    console.log("已新增 賭徒徽章");
  }

  console.log("提醒：主動技能請接著跑 node scripts/write_job_skills.js");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
