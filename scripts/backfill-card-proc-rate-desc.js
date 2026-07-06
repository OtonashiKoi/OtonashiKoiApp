"use strict";
/**
 * 補上怪物卡描述裡缺的「發動率」。
 * 規則：monsterCardSkill.trigger==="on_hit" 且 chance 介於 1~99 且描述沒提到機率/發動率的，
 *       在描述前面加「發動率 X%：」。常駐(passive)、chance=100(條件式非隨機)、已寫機率的都跳過。
 * item.description 與 monsterCardSkill.description 兩處同步更新。
 *
 *   node scripts/backfill-card-proc-rate-desc.js --dry-run
 *   node scripts/backfill-card-proc-rate-desc.js
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

function alreadyMentionsRate(desc) {
  return /機率|發動率|常駐/.test(desc || "");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const cards = await db.collection("items")
    .find({ monsterCardSkill: { $exists: true, $ne: null } })
    .toArray();

  let changed = 0, skipped = 0;
  const rows = [];
  for (const c of cards) {
    const sk = c.monsterCardSkill || {};
    const chance = Number(sk.chance || 0);
    const trigger = sk.trigger || "";
    const baseDesc = c.description || sk.description || "";

    const isProc = trigger === "on_hit" && chance > 0 && chance < 100;
    if (!isProc || alreadyMentionsRate(baseDesc)) { skipped++; continue; }

    const prefix = `發動率 ${chance}%：`;
    const newItemDesc = prefix + (c.description || "");
    const newSkillDesc = prefix + (sk.description || c.description || "");

    rows.push({ name: c.name, chance, before: baseDesc.slice(0, 60), after: (prefix + baseDesc).slice(0, 70) });

    if (!dryRun) {
      await db.collection("items").updateOne(
        { _id: c._id },
        { $set: { description: newItemDesc, "monsterCardSkill.description": newSkillDesc, updatedAt: NOW } }
      );
    }
    changed++;
  }

  console.log(`${dryRun ? "[DRY-RUN] " : ""}補發動率：${changed} 張，跳過 ${skipped} 張\n`);
  for (const r of rows) console.log(`  ${r.name.padEnd(14)} +${r.chance}%  | ${r.after}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
