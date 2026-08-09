"use strict";
/**
 * V0.5 賽季任務 seed（使用者 2026-08-07 指示建置）。
 *
 * 四條線圍繞本季新系統當教學路徑：
 *   🛡 生存線＝wb_survive_full（撐滿 15 回合，KDA 結算餵入）
 *   🔰 抗性線＝wb_resist_ready / wb_fullresist（帶抗性出戰，出戰時以裝備即時計算）
 *   🤝 貢獻線＝wb_damage_total / wb_assist_total（KDA 同源數字；輔助第一次有自己的任務）
 *   ⚔ 二轉線＝t2_transfer_done（storyService 遞交時記）
 *
 * 全部 enabled:false 建置（硬規則：新內容預設關閉），開服時由後台開啟。
 * 冪等：以 groupKey+title upsert，可重跑。
 * 用法：node scripts/seed-season-quests-v05.js
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { randomUUID } = require("crypto");

const GROUP = "season_v05_seed";
const BAG = "ticket-bag-expand";
const RESET_ATTR = "87b281be-b175-40a0-8044-0accc88a0ee0"; // 屬性重製藥水
const RESET_ENCH = "enchant_reroll_potion";                // 附魔重骰藥水

// ⚠️ 獎勵不給鑽石（使用者定案 2026-08-07：鑽石是課金貨幣）——只發 金幣／藥水／背包擴充券
const QUESTS = [
  // ── 🛡 生存線 ──
  { title: "十五回合生還者", type: "wb_survive_full", target: 1, sortOrder: 910,
    description: "在世界王戰鬥中撐滿 15 回合而不倒下（任一世界王／單人王皆可）。獎勵：3,000 金幣。",
    rewardGold: 3000 },
  { title: "百戰不殆", type: "wb_survive_full", target: 30, sortOrder: 911,
    description: "累計 30 場世界王戰鬥撐滿 15 回合。獎勵：15,000 金幣＋背包擴充券。",
    rewardGold: 15000, rewardItems: [{ itemId: BAG, qty: 1 }] },
  // ── 🔰 抗性線 ──
  { title: "屬性入門", type: "wb_resist_ready", target: 1, sortOrder: 920,
    description: "防具鑲上對應屬性石、帶著 30% 以上抗性出戰世界王（抵銷無抗性懲罰）。獎勵：3,000 金幣。",
    rewardGold: 3000 },
  { title: "滿抗證明", type: "wb_fullresist", target: 1, sortOrder: 921,
    description: "帶著 100% 滿抗（10 顆同屬性石）出戰世界王。獎勵：8,000 金幣＋附魔重骰藥水。",
    rewardGold: 8000, rewardItems: [{ itemId: RESET_ENCH, qty: 1 }] },
  { title: "抗性常備軍", type: "wb_fullresist", target: 50, sortOrder: 922,
    description: "累計 50 場帶滿抗出戰世界王。獎勵：20,000 金幣＋屬性重製藥水＋背包擴充券。",
    rewardGold: 20000, rewardItems: [{ itemId: RESET_ATTR, qty: 1 }, { itemId: BAG, qty: 1 }] },
  // ── 🤝 貢獻線（KDA 同源）──
  { title: "初試鋒芒", type: "wb_damage_total", target: 1000000, sortOrder: 930,
    description: "對世界王累計造成 100 萬傷害（含持續傷害）。獎勵：8,000 金幣。",
    rewardGold: 8000 },
  { title: "屠王輸出手", type: "wb_damage_total", target: 10000000, sortOrder: 931,
    description: "對世界王累計造成 1,000 萬傷害。獎勵：30,000 金幣＋背包擴充券＋附魔重骰藥水。",
    rewardGold: 30000, rewardItems: [{ itemId: BAG, qty: 1 }, { itemId: RESET_ENCH, qty: 1 }] },
  { title: "幕後功臣", type: "wb_assist_total", target: 500000, sortOrder: 932,
    description: "光環／治療／減傷讓隊友多打出累計 50 萬傷害當量（貢獻榜 A 值同源）。獎勵：8,000 金幣。",
    rewardGold: 8000 },
  { title: "輔助大師", type: "wb_assist_total", target: 5000000, sortOrder: 933,
    description: "助攻傷害當量累計 500 萬。獎勵：30,000 金幣＋背包擴充券＋附魔重骰藥水。",
    rewardGold: 30000, rewardItems: [{ itemId: BAG, qty: 1 }, { itemId: RESET_ENCH, qty: 1 }] },
  // ── ⚔ 二轉線 ──
  { title: "第二個身分", type: "t2_transfer_done", target: 1, sortOrder: 940,
    description: "完成職業二轉（徽章 Lv.20＋轉職劇情＋遞交）。獎勵：15,000 金幣＋附魔重骰藥水。",
    rewardGold: 15000, rewardItems: [{ itemId: RESET_ENCH, qty: 1 }] },
];

(async () => {
  const db = await getMongoDb();
  const col = db.collection("weeklyQuests");
  let upserted = 0, updated = 0;
  for (const q of QUESTS) {
    const doc = {
      cadence: "season", resetPolicy: "once", levelLimit: 0, groupKey: GROUP,
      enabled: false, // 硬規則：新內容預設關閉，開服由後台開
      rewardExp: 0, rewardDiamond: 0, rewardItemId: null, rewardItems: [],
      ...q,
      updatedAt: new Date().toISOString(),
    };
    const r = await col.updateOne(
      { groupKey: GROUP, title: q.title },
      { $set: doc, $setOnInsert: { id: randomUUID(), createdAt: new Date().toISOString() } },
      { upsert: true }
    );
    if (r.upsertedCount) upserted++; else if (r.modifiedCount) updated++;
  }
  console.log(`✅ 賽季任務 seed 完成：新建 ${upserted}、更新 ${updated}（全部 enabled:false，開服時開啟）`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
