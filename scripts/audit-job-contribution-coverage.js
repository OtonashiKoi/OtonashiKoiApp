#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");
const { supportEffectKind } = require("../src/shared/supportContribution");

const SYNTHETIC_SUPPORT = Object.freeze({
  job_sniper_t2_v1: ["support_shot"],
  job_dwarflord_t2_v1: ["world_boss_stun_window"],
  job_elementalist_t2_v1: ["zone_freeze_window"],
  job_sanctum_t2_v1: ["zone_sanctuary_window"],
});

async function main() {
  if (!config.storage.mongoUri) throw new Error("MONGODB_URI is required");
  const client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(config.storage.mongoDbName);
    const badges = await db.collection("items")
      .find({ itemType: "job_badge" })
      .sort({ id: 1 })
      .toArray();

    if (badges.length !== 24) {
      throw new Error(`正式職業徽章數量預期 24，實際 ${badges.length}；請先確認是否新增／停用職業`);
    }

    const missing = [];
    const rows = [];
    for (const badge of badges) {
      // 稽核的是徽章「有定義哪些隊伍能力」，不能用空裝備跑條件判斷；
      // 否則兵聖單手劍、吟遊詩人弓、結界師法杖條件會被誤報成沒有能力。
      const partyEffects = (Array.isArray(badge.passiveEffects) ? badge.passiveEffects : [])
        .filter((effect) => effect?.target === "party");
      const support = [];
      for (const effect of partyEffects) {
        const kind = supportEffectKind(effect.key);
        support.push(`${effect.key}:${kind || "MISSING"}`);
        if (!kind) missing.push(`${badge.name}(${badge.id}) → ${effect.key}`);
      }
      support.push(...(SYNTHETIC_SUPPORT[badge.id] || []).map((key) => `${key}:synthetic`));
      rows.push({ id: badge.id, name: badge.name, support });
    }

    console.log("═══ 正式 MongoDB：24 職業貢獻覆蓋 ═══");
    for (const row of rows) {
      console.log(`${row.support.length ? "✅" : "▫️"} ${row.name} (${row.id})：${row.support.join("、") || "無隊伍貢獻機制"}`);
    }
    if (missing.length) {
      throw new Error(`發現未分類的隊伍效果：\n${missing.join("\n")}`);
    }

    const supportedJobs = rows.filter((row) => row.support.length).length;
    console.log(`\n✅ 已逐一檢查 ${rows.length} 個職業；${supportedJobs} 個有隊伍／區域支援，其他為自身輸出或生存機制。`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`❌ 全職業貢獻覆蓋檢查失敗：${error.message}`);
  process.exitCode = 1;
});
