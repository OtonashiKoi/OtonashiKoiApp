"use strict";
/**
 * 建立「龍王的零嘴們」稱號 + 「擊敗古龍王(B) ×10」任務
 *  - 稱號：title_eq 裝備，效果 = 在龍族領地(dragon_realm) 最終傷害 +5%（zone 條件）
 *  - 任務：cadence=weekly(可重複), type=kill_dragon_king, target=10, 獎勵=該稱號
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

const TITLE_NAME = "龍王的零嘴們";
const QUEST_TITLE = "屠龍者の試煉";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  // ── 1. 稱號道具 ──
  let title = await db.collection("items").findOne({ name: TITLE_NAME, equipSlot: "title_eq" });
  const titleId = title?.id || crypto.randomUUID();
  const titleDoc = {
    id: titleId,
    name: TITLE_NAME,
    description: "擊敗古龍王(B) 十次的證明。在龍族領地戰鬥時，最終傷害 +5%。",
    itemType: "equipment",
    equipSlot: "title_eq",
    tier: null,
    equipStats: null,
    weaponType: null, isTwoHanded: false, atkStat: null,
    effect: { type: "none", value: 0 },
    useEffects: [], procEffects: [], combatEffects: [],
    passiveEffects: [
      {
        key: "final_damage_up",
        category: "offense",
        target: "self",
        trigger: "passive",
        chance: 100,
        stacks: 1,
        sourcePhase: "passive",
        params: { value: 5 },
        condition: { zone: "dragon_realm" },   // 只在龍族領地生效
        notes: "龍族領地最終傷害 +5%",
        definitionName: "Final Damage Up",
      },
    ],
    imageUrl: null, imageThumbnailUrl: null,
    tradeable: false, dropable: false,
    createdAt: title?.createdAt || NOW,
    updatedAt: NOW,
  };
  console.log(`${title ? "UPDATE" : "CREATE"} 稱號「${TITLE_NAME}」(id=${titleId.slice(0, 8)}) — 龍族領地最終傷害+5%`);
  if (!dryRun) await db.collection("items").updateOne({ id: titleId }, { $set: titleDoc }, { upsert: true });

  // ── 2. 任務 ──
  let quest = await db.collection("weeklyQuests").findOne({ type: "kill_dragon_king" });
  const questId = quest?.id || crypto.randomUUID();
  const questDoc = {
    id: questId,
    cadence: "weekly",            // 可每週重複挑戰（領過稱號後仍可刷，但稱號唯一）
    type: "kill_dragon_king",
    title: QUEST_TITLE,
    description: "擊敗世界王【古龍王(B)】10 次，獲得稱號「龍王的零嘴們」（龍族領地最終傷害 +5%）。",
    target: 10,
    rewardGold: 0,
    rewardDiamond: 0,
    rewardExp: 0,
    rewardItemId: titleId,        // 獎勵 = 稱號
    levelLimit: 40,
    resetPolicy: "once",          // 一次性：拿過稱號就完成
    enabled: true,
    sortOrder: 90,
    groupKey: "dragon_king_v1",
    createdAt: quest?.createdAt || NOW,
    updatedAt: NOW,
  };
  console.log(`${quest ? "UPDATE" : "CREATE"} 任務「${QUEST_TITLE}」type=kill_dragon_king target=10 → 獎勵稱號`);
  if (!dryRun) await db.collection("weeklyQuests").updateOne({ id: questId }, { $set: questDoc }, { upsert: true });

  console.log("─".repeat(70));
  console.log(`完成${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
