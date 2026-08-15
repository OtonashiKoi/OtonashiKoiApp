"use strict";

/**
 * 修正兩個賽季錨點任務的判定來源：
 * - 聖人：只計算實際非吸血治療量（heal_done）。
 * - 鮮血：只計算實際吸血量（lifesteal_done）。
 *
 * 舊任務只停用、不刪除；舊進度完整保留。已領取舊任務的玩家會同步成
 * 已領取新版任務，避免重複取得唯一錨點。未領取玩家從正確指標重新累積。
 *
 * 用法：
 *   node scripts/migrate-anchor-quest-metrics-v2.js --dry-run
 *   node scripts/migrate-anchor-quest-metrics-v2.js
 */
require("dotenv").config();
const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");

const OLD_THIRST_ID = "5e2e3986-e011-4ee9-b7ae-4f96dcc55275";
const OLD_SAINT_ID = "c444347d-9c6a-481b-9d4d-07e9bb6a239c";
const THIRST_ID = "season_anchor_thirst_lifesteal_v2";
const SAINT_ID = "season_anchor_saint_healing_v2";

const QUESTS = [
  {
    oldId: OLD_THIRST_ID,
    definition: {
      id: THIRST_ID,
      cadence: "season",
      enabled: true,
      title: "🩸 對鮮血的渴望・嗜血者的試煉",
      description: "【隱藏賽季任務】累積實際吸血 5 萬點後現身；解鎖後再實際吸血 5 萬點。滿血時的溢出吸血不列入。獎勵：傳說錨點【對鮮血的渴望】。",
      type: "lifesteal_done",
      target: 100000,
      unlockProgressAtLeast: 50000,
      unlockRequireSeasonDonation: false,
      rewardItemId: "s-legend-thirst",
      sortOrder: 911,
    },
  },
  {
    oldId: OLD_SAINT_ID,
    definition: {
      id: SAINT_ID,
      cadence: "season",
      enabled: true,
      title: "✝️ 聖人的試煉",
      description: "【賽季任務】累積實際非吸血治療 5 萬點。滿血溢補、治療轉傷害與吸血不列入。獎勵：傳說錨點【聖人就是比拳頭大小】。",
      type: "heal_done",
      target: 50000,
      unlockProgressAtLeast: 0,
      unlockRequireSeasonDonation: false,
      rewardItemId: "s-legend-saint",
      sortOrder: 912,
    },
  },
];

const COMMON = {
  rewardGold: 0,
  rewardExp: 0,
  rewardDiamond: 0,
  rewardItems: [],
  unlockLevel: 0,
  unlockWeaponTypes: [],
  unlockAttributes: [],
  unlockAttribute: null,
  unlockAttribute2: null,
  unlockAttributeMin: 0,
  unlockRequireItemIds: [],
  unlockCheckinStreak: 0,
  levelLimit: 0,
  hideIfRewardOwned: true,
  claimOnce: true,
  resetPolicy: "once",
  groupKey: "season_anchor_v2",
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const definitions = db.collection("weeklyQuests");
  const progress = db.collection("weeklyQuestProgress");
  const now = new Date().toISOString();

  for (const { oldId, definition } of QUESTS) {
    const claimedQuery = {
      $or: [
        { [`progress.${oldId}.claimed`]: true },
        { [`progress.${oldId}.claimedOnce`]: true },
      ],
    };
    const claimedRows = await progress.find(claimedQuery).project({ progress: 1 }).toArray();
    console.log(`[plan] ${oldId} -> ${definition.id}; 已領取玩家 ${claimedRows.length} 人`);
    if (dryRun) continue;

    await definitions.updateOne(
      { id: oldId },
      { $set: { enabled: false, replacedBy: definition.id, disabledReason: "quest_metric_corrected_v2", updatedAt: now } },
    );
    await definitions.updateOne(
      { id: definition.id },
      { $set: { ...COMMON, ...definition, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );

    for (const row of claimedRows) {
      const oldEntry = row.progress?.[oldId] || {};
      const newEntry = row.progress?.[definition.id];
      if (newEntry?.claimed || newEntry?.claimedOnce) continue;
      await progress.updateOne(
        { _id: row._id },
        { $set: { [`progress.${definition.id}`]: {
          current: definition.target,
          claimed: true,
          claimedOnce: true,
          claimedAt: oldEntry.claimedAt || now,
          migratedFrom: oldId,
        } } },
      );
    }
  }

  console.log(dryRun ? "[dry-run] 未寫入資料" : "[ok] 任務定義與已領取狀態遷移完成；舊進度未刪除");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closeMongoClient().catch(() => {}));
