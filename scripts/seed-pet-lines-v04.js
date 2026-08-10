"use strict";
/**
 * V0.4 寵物三線化：史萊姆線（大史王）＋狼牙線（地獄狼牙王），配合既有龍線（古龍王）。
 * 新制：階級孵化時定死（=物種稀有度）、無等級/進化、食量分階、採集=自身階級含以下一般裝備＋種類特色產出。
 *
 * 內容：
 *   1. pets：+10 物種（史萊姆5/狼5，含 eggType/hatchWeight/gather.lootTable/combatPassives）；
 *      既有 5 龍 backfill eggType="dragon"。
 *   2. items：+2 蛋（神秘史萊姆蛋/神秘狼牙蛋，帶 eggType）；神秘龍蛋 backfill eggType="dragon"。
 *   3. monsters.drops：史家族 4 隻＋大史王掉史萊姆蛋；火焰狼系 3 隻＋地獄狼牙王掉狼牙蛋
 *      （世界王寶箱池讀王的 drops → 蛋自動進寶箱）。
 * 依 name upsert，可重跑。 dry-run 支援。
 */
require("dotenv").config();
const crypto = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

const pv = (key, value, notes) => ({ key, target: "self", trigger: "passive", chance: 100, sourcePhase: "passive", params: { value }, notes });

// ── 物種模板 ──
// gather.lootTable: [{kind, weight}] kind ∈ gold(金幣袋按階級)/gem(強化石按階級)/equipment(≤自身階級一般裝備)
const SPECIES = [
  // 史萊姆線（後勤：金幣為主）
  { seq: 11, eggType: "slime", name: "綠史萊姆", species: "slime_green", rarity: "D", hatchWeight: 39,
    gather: { intervalMult: 1.0, lootTable: [{ kind: "gold", weight: 50 }, { kind: "gem", weight: 25 }, { kind: "equipment", weight: 25 }] },
    desc: "最常見的史萊姆，喜歡撿亮晶晶的金幣，偶爾撿回奇怪的東西。" },
  { seq: 12, eggType: "slime", name: "藍史萊姆", species: "slime_blue", rarity: "C", hatchWeight: 30,
    gather: { intervalMult: 1.0, lootTable: [{ kind: "gold", weight: 45 }, { kind: "gem", weight: 30 }, { kind: "equipment", weight: 25 }] },
    desc: "水靈靈的史萊姆，強化石與金幣均衡採集。" },
  { seq: 13, eggType: "slime", name: "星史萊姆", species: "slime_star", rarity: "B", hatchWeight: 20,
    gather: { intervalMult: 0.7, lootTable: [{ kind: "gold", weight: 50 }, { kind: "gem", weight: 25 }, { kind: "equipment", weight: 25 }] },
    desc: "身上閃著星光的史萊姆，手腳特別快（採集速度 +30%）。" },
  { seq: 14, eggType: "slime", name: "王史萊姆", species: "slime_king", rarity: "B", hatchWeight: 10,
    gather: { intervalMult: 1.0, qualityUpChance: 0.15, lootTable: [{ kind: "gold", weight: 45 }, { kind: "gem", weight: 25 }, { kind: "equipment", weight: 30 }] },
    desc: "戴著小皇冠的史萊姆，眼光很好，15% 機率撿到高一階的東西。" },
  { seq: 15, eggType: "slime", name: "虹史萊姆", species: "slime_rainbow", rarity: "A", hatchWeight: 1,
    gather: { intervalMult: 1.3, qualityUpChance: 0.3, lootTable: [{ kind: "gold", weight: 50 }, { kind: "gem", weight: 20 }, { kind: "equipment", weight: 30 }] },
    desc: "傳說中的七彩史萊姆，動作慢但眼光極佳（30% 高一階，質精量少）。" },
  // 狼牙線（戰鬥夥伴：出戰時給戰鬥加成；獵人不擅採集,速度減半、偏撿裝備）
  { seq: 21, eggType: "wolf", name: "灰紋幼狼", species: "wolf_gray", rarity: "D", hatchWeight: 39,
    gather: { intervalMult: 2.0, lootTable: [{ kind: "equipment", weight: 55 }, { kind: "gem", weight: 45 }] },
    combatPassives: [pv("atk_up", 2, "戰鬥夥伴：攻擊 +2%")],
    desc: "還在學狩獵的幼狼。出戰時攻擊 +2%。" },
  { seq: 22, eggType: "wolf", name: "黑鬃狼", species: "wolf_black", rarity: "C", hatchWeight: 30,
    gather: { intervalMult: 2.0, lootTable: [{ kind: "equipment", weight: 55 }, { kind: "gem", weight: 45 }] },
    combatPassives: [pv("atk_up", 3, "戰鬥夥伴：攻擊 +3%"), pv("combo_up", 2, "戰鬥夥伴：連擊率 +2")],
    desc: "敏捷的黑鬃狼。出戰時攻擊 +3%、連擊率 +2。" },
  { seq: 23, eggType: "wolf", name: "焰牙狼", species: "wolf_flame", rarity: "B", hatchWeight: 20,
    gather: { intervalMult: 2.0, lootTable: [{ kind: "equipment", weight: 55 }, { kind: "gem", weight: 45 }] },
    combatPassives: [
      pv("final_damage_up", 4, "戰鬥夥伴：最終傷害 +4%"),
      { key: "echo_strike", target: "self", trigger: "passive", chance: 100, sourcePhase: "passive", params: { value: 30, chance: 5 }, notes: "戰鬥夥伴：5% 機率咬擊追打（該次傷害 30%）" },
    ],
    desc: "牙帶烈焰的獵狼。出戰時最終傷害 +4%，5% 機率咬擊追打。" },
  { seq: 24, eggType: "wolf", name: "霜蹄狼", species: "wolf_frost", rarity: "B", hatchWeight: 10,
    gather: { intervalMult: 2.0, lootTable: [{ kind: "equipment", weight: 55 }, { kind: "gem", weight: 45 }] },
    combatPassives: [
      pv("physical_damage_reduction", 4, "戰鬥夥伴：物理受傷 -4%"),
      pv("magic_damage_reduction", 4, "戰鬥夥伴：魔法受傷 -4%"),
      pv("dodge_up", 3, "戰鬥夥伴：迴避 +3"),
    ],
    desc: "沉穩的護衛狼。出戰時受傷 -4%、迴避 +3。" },
  { seq: 25, eggType: "wolf", name: "月影狼王", species: "wolf_moon", rarity: "A", hatchWeight: 1,
    gather: { intervalMult: 2.0, lootTable: [{ kind: "equipment", weight: 55 }, { kind: "gem", weight: 45 }] },
    combatPassives: [
      pv("final_damage_up", 5, "戰鬥夥伴：最終傷害 +5%"),
      pv("crit_rate_up", 4, "戰鬥夥伴：爆擊率 +4"),
      { key: "echo_strike", target: "self", trigger: "passive", chance: 100, sourcePhase: "passive", params: { value: 35, chance: 8 }, notes: "戰鬥夥伴：8% 機率咬擊追打（該次傷害 35%）" },
    ],
    desc: "月夜中的傳說狼王。出戰時最終傷害 +5%、爆擊率 +4，8% 機率咬擊追打。" },
];

// ── 蛋 ──
const EGGS = [
  { name: "神秘史萊姆蛋", eggType: "slime", description: "史萊姆家族掉落的神秘蛋，孵化前看不出會孵出哪種史萊姆。餵裝備累積孵化，孵化瞬間才揭曉。" },
  { name: "神秘狼牙蛋", eggType: "wolf", description: "地獄火焰狼群掉落的神秘蛋，孵化前看不出會孵出哪種狼。餵裝備累積孵化，孵化瞬間才揭曉。" },
];

// ── 蛋掉落（怪名 → 蛋名＋機率%）。世界王的 drops 同時是寶箱池。 ──
const EGG_DROPS = [
  ["小史(小)", "神秘史萊姆蛋", 1.5], ["小史(中)", "神秘史萊姆蛋", 1.5],
  ["小史", "神秘史萊姆蛋", 1.5], ["大史(B)", "神秘史萊姆蛋", 2.0],
  ["大史王", "神秘史萊姆蛋", 3.0],
  ["焰爪幼狼", "神秘狼牙蛋", 1.0], ["烈焰狼", "神秘狼牙蛋", 1.0],
  ["煉獄烈焰狼王", "神秘狼牙蛋", 2.0], ["地獄狼牙王", "神秘狼牙蛋", 3.0],
];

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  // 1) 物種
  console.log("── 物種 ──");
  for (const sp of SPECIES) {
    const exist = await db.collection("pets").findOne({ name: sp.name });
    const doc = { ...sp, updatedAt: NOW, imageUrl: exist?.imageUrl || null, imageThumbnailUrl: exist?.imageThumbnailUrl || null };
    if (!exist) { doc.id = crypto.randomUUID(); doc.createdAt = NOW; }
    console.log(`  ${exist ? "~" : "+"} ${sp.name.padEnd(8)} ${sp.rarity} w${sp.hatchWeight} egg=${sp.eggType}${sp.combatPassives ? " ⚔" : ""}`);
    if (!dry) await db.collection("pets").updateOne({ name: sp.name }, { $set: doc }, { upsert: true });
  }
  // 龍系 backfill eggType
  const dragonFix = await db.collection("pets").updateMany(
    { eggType: { $exists: false } }, { $set: { eggType: "dragon", updatedAt: NOW } });
  console.log(`  龍系 backfill eggType=dragon: ${dry ? "(dry)" : dragonFix.modifiedCount + " 筆"}`);

  // 2) 蛋
  console.log("── 蛋 ──");
  for (const egg of EGGS) {
    const exist = await db.collection("items").findOne({ name: egg.name, itemType: "pet_egg" });
    const doc = {
      name: egg.name, itemType: "pet_egg", eggType: egg.eggType, description: egg.description,
      effect: { type: "none", value: 0 }, tier: null, tradeable: true, dropable: true,
      equipSlot: null, equipStats: null, useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
      imageUrl: exist?.imageUrl || null, imageThumbnailUrl: exist?.imageThumbnailUrl || null, updatedAt: NOW,
    };
    if (!exist) { doc.id = crypto.randomUUID(); doc.createdAt = NOW; }
    console.log(`  ${exist ? "~" : "+"} ${egg.name}（eggType=${egg.eggType}）`);
    if (!dry) await db.collection("items").updateOne({ name: egg.name, itemType: "pet_egg" }, { $set: doc }, { upsert: true });
  }
  if (!dry) await db.collection("items").updateOne({ name: "神秘龍蛋", itemType: "pet_egg" }, { $set: { eggType: "dragon", updatedAt: NOW } });
  console.log("  神秘龍蛋 backfill eggType=dragon");

  // 3) 蛋掉落
  console.log("── 蛋掉落 ──");
  for (const [monsterName, eggName, chance] of EGG_DROPS) {
    const monster = await db.collection("monsters").findOne({ name: monsterName, enabled: true });
    if (!monster) { console.log(`  SKIP 找不到怪 ${monsterName}`); continue; }
    const eggItem = await db.collection("items").findOne({ name: eggName, itemType: "pet_egg" });
    if (!eggItem) { console.log(`  SKIP 找不到蛋 ${eggName}`); continue; }
    const drops = Array.isArray(monster.drops) ? monster.drops : [];
    const idx = drops.findIndex((d) => d && d.itemId === eggItem.id);
    const dropEntry = { itemId: eggItem.id, itemName: eggItem.name, chance };
    if (idx >= 0) drops[idx] = { ...drops[idx], ...dropEntry };
    else drops.push(dropEntry);
    console.log(`  ${monsterName.padEnd(10)} ← ${eggName} @${chance}%`);
    if (!dry) await db.collection("monsters").updateOne({ _id: monster._id }, { $set: { drops, updatedAt: NOW } });
  }

  console.log(`\n${dry ? "[DRY-RUN] " : ""}完成。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
