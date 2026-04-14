"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_healer_v1";

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "治療師",
  description: "提供隊伍治療光環的徽章，被動使同場玩家獲得每回合回復。",
  itemType: "equipment",
  equipSlot: "job_eq",
  equipStats: { int: 3, vit: 2 },
  passiveEffects: [
    {
      key: "heal_over_time",
      trigger: "passive",
      target: "party",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 3, mode: "pct" },
      notes: "每回合回復隊伍成員 3% 最大 HP（需要治療師在場才生效）"
    }
  ],
  combatEffects: [],
  procEffects: [],
  enhanceLevel: 0
};

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  const items = db.collection("items");

  const now = new Date().toISOString();
  const existing = await items.findOne({ id: JOB_ITEM_ID });
  const payload = existing
    ? { ...existing, ...JOB_ITEM, updatedAt: now }
    : { ...JOB_ITEM, createdAt: now, updatedAt: now };

  await items.updateOne({ id: JOB_ITEM_ID }, { $set: payload }, { upsert: true });
  console.log(`[ok] upserted job item: ${JOB_ITEM_ID} (${JOB_ITEM.name})`);

  await client.close();
}

main().catch((error) => {
  console.error("[error] upsert job healer failed:", error);
  process.exitCode = 1;
});
