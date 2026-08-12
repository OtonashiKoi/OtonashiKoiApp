"use strict";
/**
 * 賽季任務「夏季四天王」＋同名稱號。
 *
 * 任務：四隻世界王各擊敗 5 隻（大史王／古龍王／地獄狼牙王／島島龜王）。
 *   ‧ 用 subMetrics 複合條件：每隻各自封頂 5，總進度 Σ min(子進度,5)/20 → 天然的百分比
 *   ‧ 只刷同一隻王不會過關——那隻封頂後就不再貢獻進度
 *   ‧ cadence: season（resetPolicy=once，整季只能領一次）
 *
 * 稱號：夏季四天王　掉寶 +3%／金幣 +3%
 *
 * ⚠️ 依專案規則，新增內容一律建成 enabled:false，要開放請在後台自行啟用
 *    （或跑 ENABLE=1 node scripts/upsert-season-quest-four-kings.js）。
 *
 * 用法：
 *   node scripts/upsert-season-quest-four-kings.js            # 建立（停用狀態）
 *   ENABLE=1 node scripts/upsert-season-quest-four-kings.js   # 建立並直接啟用
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ENABLE = process.env.ENABLE === "1";
const NOW = new Date().toISOString();

const TITLE_ID = "title-summer-four-kings";
const QUEST_ID = "season-summer-four-kings";

function passive(key, value, notes, definitionName) {
  return {
    key,
    category: "economy",
    stackMode: "replace",
    trigger: "passive",
    target: "self",
    chance: 100,
    stacks: 1,
    duration: { mode: "battle", value: 1 },
    sourcePhase: "passive",
    params: { value },
    condition: null,
    notes,
    definitionName,
  };
}

const TITLE = {
  id: TITLE_ID,
  name: "夏季四天王",
  description: "擊敗四方之王者的證明。掉寶率 +3%、金幣 +3%。",
  itemType: "equipment",
  equipSlot: "title_eq",
  tier: null,
  effect: { type: "none", value: 0 },
  equipStats: {},
  passiveEffects: [
    passive("drop_rate_up", 3, "掉寶率 +3%", "Drop Rate Up"),
    passive("gold_gain_up", 3, "金幣 +3%", "Gold Gain Up"),
  ],
  procEffects: [],
  combatEffects: [],
  useEffects: [],
  imageUrl: null,
  imageThumbnailUrl: null,
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  sellPrice: 0,
  updatedAt: NOW,
};

const QUEST = {
  id: QUEST_ID,
  title: "夏季四天王",
  description: "擊敗四方之王：大史王、古龍王、地獄狼牙王、島島龜王，各 5 隻。",
  cadence: "season",
  resetPolicy: "once",
  claimOnce: true,
  // type 只是分類用；實際進度由 subMetrics 決定（每隻各自封頂再加總）
  type: "kill_slime_king",
  subMetrics: [
    { type: "kill_slime_king", target: 5 },
    { type: "kill_dragon_king", target: 5 },
    { type: "kill_hellfang_king", target: 5 },
    { type: "kill_island_turtle", target: 5 },
  ],
  target: 20,
  groupKey: "season",
  sortOrder: 10,
  rewardItemId: TITLE_ID,
  rewardGold: 0,
  rewardExp: 0,
  rewardDiamond: 0,   // 🚫 任務獎勵不發鑽石
  enabled: ENABLE,
  hideIfRewardOwned: true,
  updatedAt: NOW,
};

(async () => {
  const db = await getMongoDb();

  const itemRes = await db.collection("items").updateOne(
    { id: TITLE_ID },
    { $set: TITLE, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  console.log(`稱號「${TITLE.name}」：${itemRes.upsertedCount ? "新建" : "更新"}（${TITLE_ID}）`);
  for (const e of TITLE.passiveEffects) console.log(`   ‧ ${e.notes}（${e.key}）`);

  const questRes = await db.collection("weeklyQuests").updateOne(
    { id: QUEST_ID },
    { $set: QUEST, $setOnInsert: { createdAt: NOW } },
    { upsert: true }
  );
  console.log(`\n任務「${QUEST.title}」：${questRes.upsertedCount ? "新建" : "更新"}（${QUEST_ID}）`);
  console.log(`   cadence=${QUEST.cadence}　目標 ${QUEST.target}（四隻王各 5）　enabled=${QUEST.enabled}`);
  for (const s of QUEST.subMetrics) console.log(`   ‧ ${s.type} × ${s.target}`);
  console.log(`   獎勵：${TITLE.name}（稱號）`);

  if (!ENABLE) {
    console.log("\n⚠️ 任務建成 enabled:false（未開放）。要開放請在後台啟用，或跑：");
    console.log("   ENABLE=1 node scripts/upsert-season-quest-four-kings.js");
  }
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
