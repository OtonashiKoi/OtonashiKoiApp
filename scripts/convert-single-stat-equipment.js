"use strict";
/**
 * 單屬性裝備 → 多屬性（2026-08-04 使用者定案）。
 *
 * 為什麼：強化規則是「隨機 +1 到**已有的屬性**」（enhanceService，副手/盾/防具/飾品適用），
 * 單屬性裝備會把所有強化點灌進同一條 → 屬性放大器
 * （實例：A 階疾風之戒庫值 AGI5，+5 強化後 AGI20——兩枚就 +40 AGI）。
 * 改成多屬性後，強化點自然分散。
 *
 * 範圍：**武器除外**——武器強化永遠加主屬性（不吃「隨機已有屬性」規則），
 * 而且武器主屬性直接驅動 ATK（×武器倍率），拆了等於砍武器攻擊力，是誤傷。
 *
 * 轉換規則（照現有多屬性裝備的模式，如迅紋鋼鐵甲 VIT9+AGI1+DEX5）：
 *   ‧ 總和不變
 *   ‧ 主屬性保留 ~60%（至少 1）
 *   ‧ 其餘拆給兩條副屬性（總和 2 點以下只拆一條）
 *   ‧ 副屬性依主屬性選：主 VIT → STR/DEX｜主 AGI → DEX/VIT｜主 LUK → AGI/VIT｜
 *     主 INT → DEX/VIT｜主 STR → VIT/LUK｜主 DEX → AGI/LUK
 *
 * 用法：node scripts/convert-single-stat-equipment.js [--apply]
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");

// 主屬性 → 兩條副屬性（口味上跟該主屬性「相鄰」的選擇）
const SECONDARIES = {
  vit: ["str", "dex"],
  agi: ["dex", "vit"],
  luk: ["agi", "vit"],
  int: ["dex", "vit"],
  str: ["vit", "luk"],
  dex: ["agi", "luk"],
};

function convert(equipStats) {
  const entries = Object.entries(equipStats || {}).filter(([, v]) => Number(v) > 0);
  if (entries.length !== 1) return null;                    // 不是單屬性
  const [main, rawTotal] = [entries[0][0], Number(entries[0][1])];
  const total = Math.round(rawTotal);
  const [s1, s2] = SECONDARIES[main] || ["vit", "luk"];

  const out = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  if (total <= 1) {                                          // 1 點拆不了
    out[main] = total;
    return null;                                             // 維持原樣（拆了會歸零）
  }
  if (total === 2) {                                         // 2 點 → 1+1
    out[main] = 1; out[s1] = 1;
    return out;
  }
  const mainKeep = Math.max(1, Math.round(total * 0.6));
  const rest = total - mainKeep;
  const sec1 = Math.max(1, Math.round(rest * 0.6));
  const sec2 = rest - sec1;
  out[main] = mainKeep; out[s1] = sec1;
  if (sec2 > 0) out[s2] = sec2;
  return out;
}

(async () => {
  const db = await getMongoDb();
  const I = db.collection("items");
  const items = await I.find({
    itemType: "equipment",
    equipSlot: { $nin: ["weapon", "anchor", "title_eq", "job_eq", "special"] },
  }).toArray();

  const targets = [];
  for (const it of items) {
    if (it.monsterCardOf || it.monsterCardSkill) continue;
    const next = convert(it.equipStats);
    if (next) targets.push({ it, next });
  }

  console.log(`═══ 單屬性 → 多屬性（武器除外）═══`);
  console.log(`對象 ${targets.length} 件\n`);
  const fmt = (s) => Object.entries(s).filter(([, v]) => v > 0).map(([k, v]) => k.toUpperCase() + v).join(" ");
  const bySlot = {};
  targets.forEach((t) => { (bySlot[t.it.equipSlot] = bySlot[t.it.equipSlot] || []).push(t); });
  for (const [slot, list] of Object.entries(bySlot)) {
    console.log(`── ${slot}（${list.length}）──`);
    for (const { it, next } of list) {
      console.log(`  ${String(it.tier || "-").padEnd(3)}${it.name.padEnd(16)}${fmt(it.equipStats).padEnd(10)} → ${fmt(next)}`);
    }
  }

  if (!APPLY) { console.log("\n（試跑，加 --apply 才寫入）"); process.exit(0); }

  // 備份
  await db.collection("storyChapterBackups").updateOne(
    { _id: "backup-single-stat-conversion" },
    { $set: {
      reason: "單屬性裝備轉多屬性 前備份（強化集中問題）",
      createdAt: new Date().toISOString(),
      snapshot: targets.map((t) => ({ id: t.it.id, name: t.it.name, equipStats: t.it.equipStats })),
    } },
    { upsert: true }
  );
  for (const { it, next } of targets) {
    await I.updateOne({ id: it.id }, { $set: { equipStats: next, updatedAt: new Date().toISOString() } });
  }
  console.log(`\n✅ 已轉換 ${targets.length} 件（備份 → backup-single-stat-conversion）`);
  process.exit(0);
})().catch((e) => { console.error("失敗：", e.message); process.exit(1); });
