"use strict";
/**
 * 建立 54 顆 BUILD 變化對戒（9 系列 × 左右 × CBA）
 *
 * 設計原則：
 *  - 屬性差距小：C +2 / B +3 / A +5（單一屬性）
 *  - 特殊效果遞進，左右效果不同但同主題
 *  - 不綁職業、任何人可戴
 *  - 命名格式：「{系列}左之戒 / {系列}右之戒」
 *
 * 注意：部分特殊效果（如護盾增傷、累積 buff、戰後回血）尚未在 effect engine 完整支援，
 * 先寫進 passiveEffects + description，待之後補系統。
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

const TIERS = ["C", "B", "A"];
const STAT_BONUS = { C: 2, B: 3, A: 5 };

// 9 系列 × { 名稱、補屬性、左效果定義、右效果定義 }
// 每個效果定義由三階陣列組成 [C階params, B階params, A階params]
const SERIES = [
  {
    key: "swift",
    name: "疾風",
    statKey: "agi",
    left: {
      label: "連擊率",
      effectKey: "combo_up",
      tiers: [
        { value: 5,  desc: "連擊率 +5%" },
        { value: 10, desc: "連擊率 +10%" },
        { value: 15, desc: "連擊率 +15%" },
      ],
    },
    right: {
      label: "連擊傷害",
      effectKey: "combo_damage_up",
      tiers: [
        { value: 5,  desc: "連擊時傷害 +5%" },
        { value: 13, desc: "連擊時傷害 +13%" },
        { value: 20, desc: "連擊時傷害 +20%" },
      ],
    },
  },
  {
    key: "hunter",
    name: "獵手",
    statKey: "luk",
    left: {
      label: "爆擊率",
      effectKey: "crit_rate_up",
      tiers: [
        { value: 3,  desc: "爆擊率 +3%" },
        { value: 6,  desc: "爆擊率 +6%" },
        { value: 10, desc: "爆擊率 +10%" },
      ],
    },
    right: {
      label: "爆擊傷害",
      effectKey: "crit_damage_up",
      tiers: [
        { value: 5,  desc: "爆擊傷害 +5%" },
        { value: 13, desc: "爆擊傷害 +13%" },
        { value: 20, desc: "爆擊傷害 +20%" },
      ],
    },
  },
  {
    key: "berserk",
    name: "狂血",
    statKey: "luk",
    left: {
      label: "殘血增傷",
      effectKey: "bonus_when_hp_low",
      tiers: [
        { value: 5,  threshold: 50, desc: "HP < 50% 時傷害 +5%" },
        { value: 13, threshold: 50, desc: "HP < 50% 時傷害 +13%" },
        { value: 20, threshold: 50, desc: "HP < 50% 時傷害 +20%" },
      ],
    },
    right: {
      label: "殘血減傷",
      effectKey: "bonus_reduction_when_hp_low", // 待補：HP低時減傷
      tiers: [
        { value: 5,  threshold: 50, desc: "HP < 50% 時減傷 +5%" },
        { value: 13, threshold: 50, desc: "HP < 50% 時減傷 +13%" },
        { value: 20, threshold: 50, desc: "HP < 50% 時減傷 +20%" },
      ],
    },
  },
  {
    key: "vampire",
    name: "吸血",
    statKey: "luk",
    left: {
      label: "攻擊吸血",
      effectKey: "lifesteal",
      tiers: [
        { value: 5,  desc: "攻擊回復 5% 已造成傷害" },
        { value: 10, desc: "攻擊回復 10% 已造成傷害" },
        { value: 15, desc: "攻擊回復 15% 已造成傷害" },
      ],
    },
    right: {
      label: "擊殺回血",
      effectKey: "on_kill_heal", // 待補：擊殺敵人時回血
      tiers: [
        { value: 5,  desc: "擊殺敵人回復 5% MaxHP" },
        { value: 10, desc: "擊殺敵人回復 10% MaxHP" },
        { value: 18, desc: "擊殺敵人回復 18% MaxHP" },
      ],
    },
  },
  {
    key: "mirror",
    name: "鏡映",
    statKey: "int",
    left: {
      label: "受擊反傷",
      effectKey: "reflect_damage",
      tiers: [
        { value: 8,  desc: "受擊反彈 8% 傷害" },
        { value: 16, desc: "受擊反彈 16% 傷害" },
        { value: 25, desc: "受擊反彈 25% 傷害" },
      ],
    },
    right: {
      label: "機率反擊",
      effectKey: "counter_attack",
      tiers: [
        { value: 10, desc: "受擊 10% 機率反擊 1 次" },
        { value: 20, desc: "受擊 20% 機率反擊 1 次" },
        { value: 30, desc: "受擊 30% 機率反擊 1 次" },
      ],
    },
  },
  {
    key: "medic",
    name: "救護",
    statKey: "int",
    left: {
      label: "戰鬥回血",
      effectKey: "life_regen",
      tiers: [
        { value: 5,  interval: 3, desc: "每 3 回合回復 5% MaxHP" },
        { value: 8,  interval: 3, desc: "每 3 回合回復 8% MaxHP" },
        { value: 12, interval: 3, desc: "每 3 回合回復 12% MaxHP" },
      ],
    },
    right: {
      label: "戰後回血",
      effectKey: "post_battle_heal", // 待補：戰鬥結束後回血
      tiers: [
        { value: 15, desc: "戰鬥結束回復 15% MaxHP" },
        { value: 22, desc: "戰鬥結束回復 22% MaxHP" },
        { value: 30, desc: "戰鬥結束回復 30% MaxHP" },
      ],
    },
  },
  {
    key: "heavy",
    name: "重擊",
    statKey: "str",
    left: {
      label: "慢攻爆發",
      effectKey: "final_damage_up",
      tiers: [
        { value: 5,  agiDown: 2, desc: "AGI -2，傷害 +5%" },
        { value: 13, agiDown: 3, desc: "AGI -3，傷害 +13%" },
        { value: 20, agiDown: 5, desc: "AGI -5，傷害 +20%" },
      ],
    },
    right: {
      label: "慢攻精準",
      effectKey: "hit_up",
      tiers: [
        { value: 10, agiDown: 2, desc: "AGI -2，命中 +10" },
        { value: 20, agiDown: 3, desc: "AGI -3，命中 +20" },
        { value: 30, agiDown: 5, desc: "AGI -5，命中 +30" },
      ],
    },
  },
  {
    key: "guardian",
    name: "守護",
    statKey: "vit",
    left: {
      label: "開戰護盾",
      effectKey: "shield",
      tiers: [
        { value: 5,  trigger: "battle_start", desc: "開戰給予 5% MaxHP 護盾" },
        { value: 10, trigger: "battle_start", desc: "開戰給予 10% MaxHP 護盾" },
        { value: 18, trigger: "battle_start", desc: "開戰給予 18% MaxHP 護盾" },
      ],
    },
    right: {
      label: "護盾增傷",
      effectKey: "bonus_while_shielded", // 待補：擁有護盾時增傷
      tiers: [
        { value: 5,  desc: "擁有護盾時傷害 +5%" },
        { value: 13, desc: "擁有護盾時傷害 +13%" },
        { value: 20, desc: "擁有護盾時傷害 +20%" },
      ],
    },
  },
  {
    key: "warspirit",
    name: "戰意",
    statKey: "dex",
    left: {
      label: "攻擊累積",
      effectKey: "stack_on_hit_offense", // 待補：每次出手累積 STR/DEX
      tiers: [
        { value: 1,  cap: 5,  desc: "每次出手 +1 STR/DEX（戰鬥內，上限 +5）" },
        { value: 2,  cap: 10, desc: "每次出手 +2 STR/DEX（戰鬥內，上限 +10）" },
        { value: 3,  cap: 15, desc: "每次出手 +3 STR/DEX（戰鬥內，上限 +15）" },
      ],
    },
    right: {
      label: "受擊累積",
      effectKey: "stack_on_taken_defense", // 待補：每次受擊累積 VIT/AGI
      tiers: [
        { value: 1,  cap: 5,  desc: "每次受擊 +1 VIT/AGI（戰鬥內，上限 +5）" },
        { value: 2,  cap: 10, desc: "每次受擊 +2 VIT/AGI（戰鬥內，上限 +10）" },
        { value: 3,  cap: 15, desc: "每次受擊 +3 VIT/AGI（戰鬥內，上限 +15）" },
      ],
    },
  },
];

function emptyStats() {
  return { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
}

function buildRing(series, side, tierIdx) {
  const tier = TIERS[tierIdx];
  const sideDef = series[side];
  const tierDef = sideDef.tiers[tierIdx];
  const sideLabel = side === "left" ? "左" : "右";
  const slot = side === "left" ? "accessory_l" : "accessory_r";
  const name = `${series.name}${sideLabel}之戒`;
  const stats = emptyStats();
  stats[series.statKey] = STAT_BONUS[tier];
  if (tierDef.agiDown) stats.agi = -tierDef.agiDown;

  // 組 params（過濾 undefined）
  const params = {};
  if (tierDef.value !== undefined) params.value = tierDef.value;
  if (tierDef.threshold !== undefined) params.threshold = tierDef.threshold;
  if (tierDef.interval !== undefined) params.interval = tierDef.interval;
  if (tierDef.cap !== undefined) params.cap = tierDef.cap;
  if (tierDef.trigger) params.trigger = tierDef.trigger;

  const passiveEffect = {
    key: sideDef.effectKey,
    target: "self",
    trigger: tierDef.trigger || "passive",
    chance: 100,
    sourcePhase: "passive",
    params,
  };

  return {
    id: crypto.randomUUID(),
    seq: 0,
    name,
    description: `[${tier}階 / ${series.name}系] ${tierDef.desc}`,
    itemType: "equipment",
    equipSlot: slot,
    tier,
    equipStats: stats,
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    imageUrl: null,
    imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    passiveEffects: [passiveEffect],
    procEffects: [],
    combatEffects: [],
    useEffects: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function main() {
  const db = await getMongoDb();
  const items = db.collection("items");

  const docs = [];
  for (const series of SERIES) {
    for (const side of ["left", "right"]) {
      for (let t = 0; t < TIERS.length; t++) {
        docs.push(buildRing(series, side, t));
      }
    }
  }

  console.log(`準備建立 ${docs.length} 顆戒指：`);
  const summary = docs.map(d => `  ${d.tier} ${d.name} (${d.equipSlot}) -> ${d.passiveEffects[0].key} ${JSON.stringify(d.passiveEffects[0].params)}`);
  console.log(summary.join("\n"));

  // 移除舊版（如果之前跑過）
  const existingNames = docs.map(d => d.name);
  const delRes = await items.deleteMany({ name: { $in: existingNames } });
  console.log(`刪除舊版 ${delRes.deletedCount} 筆。`);

  // 寫入新版（用 _id auto）
  const insertDocs = docs.map(d => ({ ...d, _id: crypto.randomBytes(12).toString("hex") }));
  const insertRes = await items.insertMany(insertDocs);
  console.log(`已寫入 ${insertRes.insertedCount} 顆戒指。`);

  // 輸出對應 ID 表（給後續 drop 綁定用）
  console.log("\n--- 對戒 ID 對照表 ---");
  for (const d of insertDocs) {
    console.log(`${d.tier}\t${d.name}\t${d.id}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
