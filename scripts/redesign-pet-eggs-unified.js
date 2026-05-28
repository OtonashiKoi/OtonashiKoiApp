"use strict";
/**
 * 寵物蛋改版：5 種蛋 → 1 種「神秘龍蛋」（看不出結果），孵化時隨機開獎
 *  1. 建立單一「神秘龍蛋」item（itemType pet_egg）
 *  2. 5 種龍寵種類定義加採集 modifier（速度倍率/產出偏好/高一階機率）+ 孵化權重
 *  3. dragon_realm 10 隻怪 drops：移除舊 5 種蛋，改掉「神秘龍蛋」
 *  4. 停用（標記）舊的 5 種蛋 item（保留資料但不再掉落）
 *
 * 執行：node scripts/redesign-pet-eggs-unified.js [--dry-run]
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();
const MYSTERY_EGG_NAME = "神秘龍蛋";

// 各龍採集 modifier（全平均 20% 抽中，差異在玩法）
//  intervalMult：採集間隔倍率（<1 更快、>1 更慢）
//  gemBias：產出強化石比例（其餘為裝備）
//  qualityUpChance：掉「高一階」道具的機率（0~1）
const SPECIES = [
  { name: "火苗龍", species: "fire",    weight: 1, intervalMult: 1.0,  gemBias: 0.85, qualityUpChance: 0,    desc: "火龍，偏好撿拾強化石。" },
  { name: "霜鱗龍", species: "ice",     weight: 1, intervalMult: 1.0,  gemBias: 0.60, qualityUpChance: 0,    desc: "冰龍，強化石與裝備均衡採集。" },
  { name: "雷鳴龍", species: "thunder", weight: 1, intervalMult: 0.70, gemBias: 0.70, qualityUpChance: 0,    desc: "雷龍，採集速度極快（+30%）。" },
  { name: "黑曜龍", species: "dark",    weight: 1, intervalMult: 1.0,  gemBias: 0.30, qualityUpChance: 0.15, desc: "夜行龍，偏好挖裝備，15% 機率高一階。" },
  { name: "黃金龍", species: "gold",    weight: 1, intervalMult: 1.30, gemBias: 0.50, qualityUpChance: 0.30, desc: "黃金龍，採集慢但 30% 機率高一階（質精量少）。" },
];

const DRAGON_REALM_MONSTERS = [
  { name: "飛龍幼崽",     chance: 1.5 },
  { name: "龍蜥武士",     chance: 1.2 },
  { name: "火翼龍人",     chance: 1.2 },
  { name: "冰鱗龍人",     chance: 1.2 },
  { name: "雷霆飛龍",     chance: 1.0 },
  { name: "黑曜龍騎",     chance: 1.0 },
  { name: "黃金幼龍(稀)", chance: 2.5 },  // 稀有種掉蛋率高
  { name: "暗影龍將",     chance: 1.0 },
  { name: "龍翼魔法師",   chance: 1.0 },
  { name: "古龍王(B)",    chance: 3.5 },  // BOSS 掉蛋率最高
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`寵物蛋統一改版（dryRun=${dryRun}）`);
  console.log("─".repeat(90));

  // ── 1. 建立/更新「神秘龍蛋」 ──
  let egg = await db.collection("items").findOne({ name: MYSTERY_EGG_NAME, itemType: "pet_egg" });
  const eggId = egg?.id || crypto.randomUUID();
  const eggDoc = {
    id: eggId,
    name: MYSTERY_EGG_NAME,
    description: "龍族之領掉落的神秘蛋，孵化前看不出會孵出哪種龍。餵裝備累積孵化，孵化瞬間才揭曉。",
    itemType: "pet_egg",
    petId: null,            // 通用蛋：不綁種類，孵化時才 roll
    petSpecies: null,
    rarity: null,
    stackable: true,
    imageUrl: null, imageThumbnailUrl: null,
    effect: { type: "none", value: 0 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
    atkStat: null, tier: null,
    createdAt: egg?.createdAt || NOW, updatedAt: NOW,
  };
  console.log(`${egg ? "UPDATE" : "CREATE"} 神秘龍蛋 (id=${eggId.slice(0,8)})`);
  if (!dryRun) await db.collection("items").updateOne({ id: eggId }, { $set: eggDoc }, { upsert: true });

  // ── 2. 更新 5 種龍寵 modifier + 權重 ──
  for (const sp of SPECIES) {
    const petDoc = await db.collection("pets").findOne({ name: sp.name });
    if (!petDoc) { console.warn(`⚠ 找不到種類 ${sp.name}`); continue; }
    const gather = {
      intervalMult: sp.intervalMult,
      gemBias: sp.gemBias,
      qualityUpChance: sp.qualityUpChance,
    };
    console.log(`UPDATE 種類 ${sp.name}  間隔×${sp.intervalMult} 石${Math.round(sp.gemBias*100)}% 高一階${Math.round(sp.qualityUpChance*100)}% 權重${sp.weight}`);
    if (!dryRun) {
      await db.collection("pets").updateOne(
        { id: petDoc.id },
        { $set: { gather, hatchWeight: sp.weight, description: sp.desc, eggItemId: eggId, updatedAt: NOW } }
      );
    }
  }

  console.log("─".repeat(90));

  // ── 3. dragon_realm 怪 drops：移除舊蛋、改掛神秘龍蛋 ──
  const oldEggItems = await db.collection("items").find({ itemType: "pet_egg", name: { $ne: MYSTERY_EGG_NAME } }).toArray();
  const oldEggIds = new Set(oldEggItems.map((e) => e.id));
  let dropUpdated = 0;
  for (const m of DRAGON_REALM_MONSTERS) {
    const monster = await db.collection("monsters").findOne({ zone: "dragon_realm", name: m.name });
    if (!monster) { console.warn(`⚠ 找不到怪 ${m.name}`); continue; }
    let drops = Array.isArray(monster.drops) ? monster.drops.filter((d) => !oldEggIds.has(d.itemId)) : [];
    const idx = drops.findIndex((d) => d.itemId === eggId);
    const entry = { itemId: eggId, itemName: MYSTERY_EGG_NAME, chance: m.chance };
    if (idx >= 0) drops[idx] = entry; else drops.push(entry);
    console.log(`DROP  ${m.name.padEnd(16)} + ${MYSTERY_EGG_NAME}@${m.chance}%（清掉舊蛋）`);
    if (!dryRun) await db.collection("monsters").updateOne({ _id: monster._id }, { $set: { drops } });
    dropUpdated++;
  }

  // ── 4. 停用舊 5 種蛋（標記 enabled:false，不刪資料）──
  if (oldEggItems.length) {
    console.log("─".repeat(90));
    for (const e of oldEggItems) {
      console.log(`DISABLE 舊蛋 ${e.name}`);
      if (!dryRun) await db.collection("items").updateOne({ id: e.id }, { $set: { enabled: false, deprecated: true, updatedAt: NOW } });
    }
  }

  console.log("─".repeat(90));
  console.log(`完成：神秘龍蛋 1、種類 modifier ${SPECIES.length}、掉落 ${dropUpdated}、停用舊蛋 ${oldEggItems.length}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
