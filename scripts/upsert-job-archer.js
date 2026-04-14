"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_archer_v1";

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "弓箭手",
  description: "擅長遠程射擊的職業，弓術造成高爆發傷害並能在迴避後反擊。",
  itemType: "equipment",
  equipSlot: "job_eq",
  equipStats: { dex: 5, agi: 1, luk: 2 },
  passiveEffects: [
    // 在怪物迴避時的反擊能力（需要主武為弓）
    {
      key: "counter_on_dodge",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      condition: { weaponType: "bow" },
      notes: "主武為弓時：在迴避怪物攻擊後進行反擊（反擊必定會心/爆擊）"
    }
  ],
  combatEffects: [
    // 主武為弓時武器倍率 x1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "bow" },
      notes: "主武器為弓時，武器倍率後額外 x1.2" 
    }
  ],
  procEffects: [
    // 主武為弓時：有基礎 45% 機率觸發弱點一擊，受 DEX 加成上限 80%，傷害 x1.5
    {
      key: "proc_weak_spot",
      trigger: "on_hit",
      target: "enemy",
      chance: 45,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "turns", value: 1 },
      params: { perDex: 0.5, maxChance: 80, damageMultiplier: 1.5 },
      condition: { weaponType: "bow" },
      notes: "主武為弓時：基礎 45% 機率，隨 DEX 增加（每點 DEX +0.5%），上限 80%，觸發時該攻擊傷害 x1.5"
    }
  ],
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
  console.error("[error] upsert job archer failed:", error);
  process.exitCode = 1;
});
