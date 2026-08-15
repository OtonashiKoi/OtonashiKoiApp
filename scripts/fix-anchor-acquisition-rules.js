#!/usr/bin/env node
"use strict";

/**
 * 修正現行錨點任務的顯示門檻與完成門檻。
 * 預設只預覽；加 --apply 才寫入。只改任務定義，不補發道具、不改玩家進度。
 */
require("dotenv").config();
const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
const { ANCHOR_QUEST_RULES } = require("../src/shared/anchorQuestRules");

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getMongoDb();
  const definitions = db.collection("weeklyQuests");
  const now = new Date().toISOString();

  for (const rule of ANCHOR_QUEST_RULES) {
    const current = await definitions.findOne(
      { id: rule.questId },
      { projection: { _id: 0, id: 1, title: 1, rewardItemId: 1, target: 1, unlockProgressAtLeast: 1, unlockCheckinStreak: 1, unlockRequireSeasonDonation: 1 } },
    );
    if (!current) throw new Error(`找不到錨點任務：${rule.questId}`);
    if (String(current.rewardItemId) !== rule.rewardItemId) {
      throw new Error(`任務獎勵不符：${rule.questId} 預期 ${rule.rewardItemId}，實際 ${current.rewardItemId}`);
    }
    console.log(`[${apply ? "apply" : "dry-run"}] ${current.title}`);
    console.log(`  current=${JSON.stringify(current)}`);
    console.log(`  target =${JSON.stringify(rule.fields)}`);
    if (apply) {
      await definitions.updateOne(
        { id: rule.questId, rewardItemId: rule.rewardItemId },
        { $set: { ...rule.fields, updatedAt: now } },
      );
    }
  }

  console.log(apply
    ? "[ok] 錨點任務規則已更新；未補發道具、未修改玩家進度"
    : "[dry-run] 未寫入資料；加 --apply 才會套用");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closeMongoClient().catch(() => {}));
