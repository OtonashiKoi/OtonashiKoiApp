"use strict";
/**
 * 為法師徽章(job_mage_v1)補上「雙手法杖(staff_2h)」的元素職業技能 proc。
 * 原本只有單手杖(staff_1h)會觸發燒傷/麻痺/冰凍(各 8%)，雙手杖只有純被動(ATK+40%、無視防禦35%)。
 * 依使用者需求：雙手杖也要有這三招，且機率比單手杖「高一點」→ 12%(單手 8%)。
 * 其餘數值/持續時間沿用單手杖版本；freeze 維持 bossImmune。
 * 可重複執行(idempotent)：會先移除既有 staff_2h 的同類 proc 再重加。
 * 戰鬥讀取走 mergeEquippedFromLibrary(以 itemId 抓主檔最新效果)，改主檔即對全玩家生效，免遷移。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const BADGE_ID = "job_mage_v1";
const TWOH_CHANCE = 12; // 單手杖為 8

const TWOH_PROCS = [
  {
    key: "hit_down", category: "stat", trigger: "on_hit", target: "enemy",
    chance: TWOH_CHANCE, stacks: 1, stackMode: "refresh",
    duration: { mode: "turns", value: 3 }, sourcePhase: "passive",
    params: { value: 15 }, condition: { weaponType: "staff_2h" },
    notes: "雙手法杖：命中時有機率降低敵方命中", definitionName: "hit_down",
  },
  {
    key: "burn", category: "dot", trigger: "on_hit", target: "enemy",
    chance: TWOH_CHANCE, stacks: 1, stackMode: "refresh",
    duration: { mode: "turns", value: 3 }, sourcePhase: "passive",
    params: { value: 0.8, mode: "pct" }, condition: { weaponType: "staff_2h" },
    notes: "雙手法杖：命中時有機率燒傷", definitionName: "burn",
  },
  {
    key: "freeze", category: "control", trigger: "on_hit", target: "enemy",
    chance: TWOH_CHANCE, stacks: 1, stackMode: "replace",
    duration: { mode: "turns", value: 1 }, sourcePhase: "passive",
    params: { bossImmune: true }, condition: { weaponType: "staff_2h" },
    notes: "雙手法杖：命中時有機率冰凍", definitionName: "freeze",
  },
];

const NEW_KEYS = new Set(TWOH_PROCS.map((p) => p.key));

(async () => {
  const db = await getMongoDb();
  const badge = await db.collection("items").findOne({ id: BADGE_ID });
  if (!badge) { console.error(`找不到徽章 ${BADGE_ID}`); process.exit(1); }

  const prev = Array.isArray(badge.procEffects) ? badge.procEffects : [];
  // 保留所有「非(staff_2h 且屬於這三招)」的既有 proc；移除舊的 staff_2h 同類避免重複
  const kept = prev.filter((p) => {
    const isTwoH = p?.condition?.weaponType === "staff_2h";
    return !(isTwoH && NEW_KEYS.has(p.key));
  });
  const next = [...kept, ...TWOH_PROCS];

  await db.collection("items").updateOne(
    { id: BADGE_ID },
    { $set: { procEffects: next, updatedAt: new Date().toISOString() } }
  );

  console.log(`已更新 ${badge.name} (${BADGE_ID})`);
  console.log("procEffects 現況：");
  for (const p of next) {
    console.log(`  - ${p.key.padEnd(9)} ${p.condition?.weaponType || "-"} chance=${p.chance} ${p.notes || ""}`);
  }
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
