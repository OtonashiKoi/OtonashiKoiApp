"use strict";

require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_QUEST_UNLOCKS = [
  {
    rewardItemId: "job_swordsman_v1",
    description: "出現條件：Lv.10，基礎 STR + DEX > 10。進度武器：單手劍或雙手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與劍士徽章。",
    attrs: ["str", "dex"]
  },
  {
    rewardItemId: "job_warrior_v1",
    description: "出現條件：Lv.10，基礎 STR + VIT > 10。進度武器：單手斧或雙手斧；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與戰士徽章。",
    attrs: ["str", "vit"]
  },
  {
    rewardItemId: "job_dwarf_warrior_v1",
    description: "出現條件：Lv.10，基礎 VIT + STR > 10。進度武器：單手槌或雙手槌；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與矮人戰士徽章。",
    attrs: ["vit", "str"]
  },
  {
    rewardItemId: "job_rogue_v1",
    description: "出現條件：Lv.10，基礎 AGI + DEX > 10。進度武器：匕首；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與盜賊徽章。",
    attrs: ["agi", "dex"]
  },
  {
    rewardItemId: "job_mage_v1",
    description: "出現條件：Lv.10，基礎 INT + AGI > 10。進度武器：雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與法師徽章。",
    attrs: ["int", "agi"]
  },
  {
    rewardItemId: "job_healer_v1",
    description: "出現條件：Lv.10，基礎 INT + VIT > 10。進度武器：單手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與治療師徽章。",
    attrs: ["int", "vit"]
  },
  {
    rewardItemId: "job_archer_v1",
    description: "出現條件：Lv.10，基礎 DEX + AGI > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與弓箭手徽章。",
    attrs: ["dex", "agi"]
  },
  {
    rewardItemId: "job_tactician_v1",
    description: "出現條件：Lv.10，基礎 AGI + INT + DEX > 10。進度武器：單手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與軍師徽章。",
    attrs: ["agi", "int", "dex"]
  },
  {
    rewardItemId: "job_bard_v1",
    description: "出現條件：Lv.10，基礎 DEX + AGI + LUK > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與詩人徽章。",
    attrs: ["dex", "agi", "luk"]
  },
  {
    rewardItemId: "job_barrier_mage_v1",
    description: "出現條件：Lv.10，基礎 INT + VIT + DEX > 10。進度武器：單手法杖或雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與結界師徽章。",
    attrs: ["int", "vit", "dex"]
  }
];

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  try {
    const db = client.db(config.storage.mongoDbName);
    const quests = db.collection("weeklyQuests");
    const now = new Date().toISOString();

    for (const quest of JOB_QUEST_UNLOCKS) {
      const result = await quests.updateOne(
        { cadence: "job", rewardItemId: quest.rewardItemId },
        {
          $set: {
            description: quest.description,
            unlockAttributes: quest.attrs,
            unlockAttribute: quest.attrs[0] || null,
            unlockAttribute2: quest.attrs[1] || null,
            unlockAttributeMin: 10,
            updatedAt: now
          }
        }
      );
      console.log(`[${result.matchedCount ? "ok" : "skip"}] ${quest.rewardItemId}`);
    }
  } finally {
    await client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
