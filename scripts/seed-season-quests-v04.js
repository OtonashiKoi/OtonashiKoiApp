"use strict";
/**
 * V0.4 賽季任務（成就型，cadence=season / resetPolicy=once）。
 * 內容：
 *   1) 確保「狼王的磨牙棒」稱號道具存在（比照龍王的零嘴們：title_eq、火焰區終傷+5%、靈魂綁定）。
 *   2) upsert 6 隻賽季任務（含多道具獎勵 rewardItems: [{itemId, qty}]）。
 * 依 title / name upsert，可重跑不重複。
 */
require("dotenv").config();
const crypto = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// 道具 ID
const REROLL_POTION = "enchant_reroll_potion";                         // 附魔重骰藥水
const RESPEC_POTION = "87b281be-b175-40a0-8044-0accc88a0ee0";          // 屬性重製藥水（洗點）
const DRAGON_TITLE  = "f5d8903b-5d19-46d7-a1f5-3af1672ee833";          // 龍王的零嘴們（既有稱號）
const WOLF_TITLE_ID = "b4f8c3f3-39f2-4c5e-9c30-61812156a936";          // 狼王的磨牙棒（本腳本建立）
const SLIME_TITLE_ID = "0aa0f96b-2ada-482f-87b7-55ffedc0bc36";         // 大史王的黏液球（本腳本建立）

// 狼王稱號道具（比照龍王的零嘴們）
const WOLF_TITLE_ITEM = {
  id: WOLF_TITLE_ID,
  name: "狼王的磨牙棒",
  itemType: "equipment",
  equipSlot: "title_eq",
  description: "擊敗世界王【地獄狼牙王】十次的證明。在地獄火焰或焰獄深處戰鬥時，最終傷害 +5%。",
  effect: { type: "none", value: 0 },
  equipStats: null,
  atkStat: null,
  tier: null,
  dropable: false,
  tradeable: false,
  isTwoHanded: false,
  weaponType: null,
  imageUrl: null,
  imageThumbnailUrl: null,
  useEffects: [],
  procEffects: [],
  combatEffects: [],
  passiveEffects: [
    {
      key: "final_damage_up", category: "offense", target: "self", trigger: "passive",
      chance: 100, stacks: 1, sourcePhase: "passive",
      params: { value: 5 },
      condition: { zone: ["hellfire", "hellfire_depths"] },
      notes: "地獄火焰／焰獄深處最終傷害 +5%",
      definitionName: "Final Damage Up",
    },
  ],
};

// 大史王稱號（三世界王最入門者；買一條 A 路線傷害＝古城深處/秘銀線，與龍/火三線對稱）
const SLIME_TITLE_ITEM = {
  id: SLIME_TITLE_ID,
  name: "大史王的黏液球",
  itemType: "equipment",
  equipSlot: "title_eq",
  description: "擊敗世界王【大史王】十次的證明。在古城深處或大史王試煉之地戰鬥時，最終傷害 +5%。",
  effect: { type: "none", value: 0 },
  equipStats: null,
  atkStat: null,
  tier: null,
  dropable: false,
  tradeable: false,
  isTwoHanded: false,
  weaponType: null,
  imageUrl: null,
  imageThumbnailUrl: null,
  useEffects: [],
  procEffects: [],
  combatEffects: [],
  passiveEffects: [
    {
      key: "final_damage_up", category: "offense", target: "self", trigger: "passive",
      chance: 100, stacks: 1, sourcePhase: "passive",
      params: { value: 5 },
      condition: { zone: ["ancient_city_deep", "elite"] },
      notes: "古城深處／大史王試煉最終傷害 +5%",
      definitionName: "Final Damage Up",
    },
  ],
};

const TITLE_ITEMS = [WOLF_TITLE_ITEM, SLIME_TITLE_ITEM];

// title, type, target, sortOrder, gold, exp, rewardItemId(稱號/主獎), rewardItems, description
const QUESTS = [
  ["屠史者の試煉", "kill_slime_king", 10, 5, 0, 0, SLIME_TITLE_ID,
    [{ itemId: REROLL_POTION, qty: 5 }, { itemId: RESPEC_POTION, qty: 1 }],
    "擊敗世界王【大史王】10 次，獲得稱號「大史王的黏液球」（古城深處／大史王試煉最終傷害 +5%）＋附魔重骰藥水 ×5＋屬性重製藥水 ×1。"],
  ["屠龍者の試煉", "kill_dragon_king", 10, 10, 0, 0, DRAGON_TITLE,
    [{ itemId: REROLL_POTION, qty: 5 }, { itemId: RESPEC_POTION, qty: 1 }],
    "擊敗世界王【古龍王(B)】10 次，獲得稱號「龍王的零嘴們」（龍族之領／龍王巢穴最終傷害 +5%）＋附魔重骰藥水 ×5＋屬性重製藥水 ×1。"],
  ["屠狼者の試煉", "kill_hellfang_king", 10, 20, 0, 0, WOLF_TITLE_ID,
    [{ itemId: REROLL_POTION, qty: 5 }, { itemId: RESPEC_POTION, qty: 1 }],
    "擊敗世界王【地獄狼牙王】10 次，獲得稱號「狼王的磨牙棒」（地獄火焰／焰獄深處最終傷害 +5%）＋附魔重骰藥水 ×5＋屬性重製藥水 ×1。"],
  ["焰獄審判", "burn_trigger_count", 1000, 30, 150000, 100000, null, [],
    "在戰鬥中累計觸發燃燒 1000 次（地獄火焰怪、火焰流派卡最容易累積）。獎勵：150,000 金幣 + 100,000 經驗。"],
  ["千錘百鍊", "enhance_a5_count", 10, 40, 150000, 100000, null, [],
    "把 A 階裝備強化到 +5 累積 10 件，鍛鍊出一身頂裝。獎勵：150,000 金幣 + 100,000 經驗。"],
  ["百戰之證", "battle_win", 1500, 50, 200000, 150000, null, [],
    "累計戰鬥勝利 1500 場，久經沙場之證。獎勵：200,000 金幣 + 150,000 經驗。"],
  ["連擊宗師", "combo_count", 3000, 60, 150000, 100000, null, [],
    "累計成功連擊 3000 次（匕首／高 AGI 最易累積）。獎勵：150,000 金幣 + 100,000 經驗。"],
];

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const items = db.collection("items");
  const col = db.collection("weeklyQuests");

  // 1) 稱號道具（狼王／大史王）
  for (const t of TITLE_ITEMS) {
    const existTitle = await items.findOne({ id: t.id });
    console.log(`稱號道具「${t.name}」：${existTitle ? "已存在→更新" : "新建"}`);
    if (!dry) {
      await items.updateOne({ id: t.id },
        { $set: { ...t, updatedAt: NOW }, $setOnInsert: { createdAt: NOW } },
        { upsert: true });
    }
  }

  // 2) 賽季任務
  console.log("-".repeat(88));
  let ins = 0, upd = 0;
  for (const [title, type, target, sortOrder, gold, exp, rewardItemId, rewardItems, description] of QUESTS) {
    const existing = await col.findOne({ cadence: "season", title });
    const doc = {
      cadence: "season", type, target, sortOrder, title, description, enabled: true,
      // 整季累積型成就：不設等級門檻，從 Lv.1 就可見、進度全季累積（世界王擊殺類自然靠進入王區為門檻）
      groupKey: "season_achievements_v1", levelLimit: 0, resetPolicy: "once",
      rewardGold: gold, rewardExp: exp, rewardDiamond: 0,
      rewardItemId: rewardItemId || null, rewardItems: rewardItems || [],
      updatedAt: NOW,
    };
    const itemsTxt = [rewardItemId ? "稱號" : null, ...(rewardItems || []).map((r) => `${r.itemId === REROLL_POTION ? "重骰" : "洗點"}×${r.qty}`)].filter(Boolean).join("+") || "純金經";
    if (existing) {
      console.log(`  ~ 更新 ${title.padEnd(10)} ${type} ×${target} | 金${gold}/經${exp} | ${itemsTxt}`);
      if (!dry) await col.updateOne({ _id: existing._id }, { $set: doc });
      upd++;
    } else {
      doc.id = crypto.randomUUID(); doc.createdAt = NOW;
      console.log(`  + 新增 ${title.padEnd(10)} ${type} ×${target} | 金${gold}/經${exp} | ${itemsTxt}`);
      if (!dry) await col.insertOne(doc);
      ins++;
    }
  }
  console.log("-".repeat(88));
  console.log(`${dry ? "[DRY-RUN] " : ""}完成：新增 ${ins}、更新 ${upd}。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
