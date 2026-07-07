"use strict";
/**
 * 火焰裝備套組。
 *   A 武器×10 / S 武器×10 / A 防具×5 = 25 件（防具只有 A、S 只有武器）
 *   S 武器：final_damage_up +20% zone=[hellfire,hellfire_depths]（焚獄特攻，同龍系S）
 *   A 防具：集滿 5 件 →「焚獄之王」套裝效果(掛在焰鱗甲，condition.all 檢查全套)
 *   掉落：A 武器→各基礎怪(對應武器流派)、A 防具→菁英；S 武器→世界王寶箱池
 * 可重複執行（語意 id upsert）。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();
const ZONES = ["hellfire", "hellfire_depths"];

const S6 = (o = {}) => ({ str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0, ...o });
function fdZone(value) {
  return { key: "final_damage_up", target: "self", trigger: "passive", chance: 100, stacks: 1, stackMode: "replace",
    duration: { mode: "battle", value: 1 }, params: { value }, condition: { zone: ZONES }, notes: "焚獄特攻" };
}
function eff(key, value, condition) {
  const e = { key, target: "self", trigger: "passive", chance: 100, stacks: 1, stackMode: "replace",
    duration: { mode: "battle", value: 1 }, params: { value } };
  if (condition) e.condition = condition;
  return e;
}

// wt, A名, S名, 數值, atkStat, 雙手
const WEAPONS = [
  ["sword_1h", "焰紋單手劍", "獄焰・狼牙劍", { str: 19 }, "str", false],
  ["sword_2h", "焰紋雙手劍", "獄焰・裂天巨劍", { str: 25 }, "str", true],
  ["mace_1h",  "熔火單手槌", "獄焰・碎顱槌",   { str: 14, vit: 5 }, "str", false],
  ["mace_2h",  "熔火雙手槌", "獄焰・崩地槌",   { str: 20, vit: 5 }, "str", true],
  ["axe_1h",   "烈焰單手斧", "獄焰・撕裂手斧", { str: 14, luk: 5 }, "str", false],
  ["axe_2h",   "烈焰雙手斧", "獄焰・焚天巨斧", { str: 20, luk: 5 }, "str", true],
  ["dagger",   "焰刃匕首",   "獄焰・狼牙短刃", { str: 4, agi: 15 }, "str", false],
  ["staff_1h", "焰心單手法杖", "獄焰・魂焚法杖", { int: 14, dex: 5 }, "int", false],
  ["staff_2h", "焰心雙手法杖", "獄焰・煉獄長杖", { int: 19, dex: 4 }, "int", true],
  ["bow",      "焰羽獵弓",   "獄焰・炎狼獵弓", { agi: 4, dex: 19 }, "dex", true],
];
// slot, A名, 數值（防具只有 A；全 9 槽含飾品）
const ARMOR = [
  ["armor",       "焰鱗甲",     { vit: 15 }],        // 核心(3/6/9 都需要，套裝效果掛這件)
  ["head_top",    "焰鱗盔",     { vit: 13 }],        // 核心(3)
  ["shoes",       "焰鱗戰靴",   { agi: 5, vit: 8 }], // 核心(3)
  ["shield",      "焰鱗盾",     { vit: 14 }],        // 6
  ["garment",     "焰鱗披風",   { agi: 1, vit: 11 }],// 6
  ["head_mid",    "焰鱗護目",   { vit: 9, str: 3 }], // 6
  ["head_low",    "焰鱗口罩",   { str: 2, vit: 9 }], // 9
  ["accessory_l", "焰紋戒指(左)", { str: 3, luk: 2 }], // 9
  ["accessory_r", "焰紋戒指(右)", { str: 3, vit: 2 }], // 9
];
// 3/6/9 階梯所需核心件（slot）
const TIER3 = ["armor", "head_top", "shoes"];
const TIER6 = [...TIER3, "shield", "garment", "head_mid"];
const TIER9 = [...TIER6, "head_low", "accessory_l", "accessory_r"];
const MONSTER_WEAPON = {
  "焰爪幼狼": "dagger", "灰燼豺": "axe_1h", "熔岩犬": "sword_1h", "硫火蝙蝠": "bow", "焦炎蜥": "staff_2h",
  "火髓魔蟲": "staff_1h", "餘燼骷髏": "sword_2h", "炙炎鴉": "mace_1h", "岩漿巨蟲": "axe_2h", "烈焰狼": "mace_2h",
};
const BOSS_ID = "0393acee-9851-4bcb-a8f5-fdb60a9968f1"; // 地獄狼牙王

function weaponDoc(id, name, tier, wt, stats, atkStat, twoH, effects, desc) {
  return { id, name, itemType: "equipment", tier, equipSlot: "weapon", weaponType: wt, isTwoHanded: twoH,
    atkStat, equipStats: S6(stats), effect: { type: "none", value: 0 },
    passiveEffects: effects, procEffects: [], combatEffects: [], useEffects: [],
    imageUrl: null, imageThumbnailUrl: null, description: desc, createdAt: NOW, updatedAt: NOW };
}
function armorDoc(id, name, slot, stats, effects, desc) {
  return { id, name, itemType: "equipment", tier: "A", equipSlot: slot, weaponType: null, isTwoHanded: false,
    atkStat: null, equipStats: S6(stats), effect: { type: "none", value: 0 },
    passiveEffects: effects, procEffects: [], combatEffects: [], useEffects: [],
    imageUrl: null, imageThumbnailUrl: null, description: desc, createdAt: NOW, updatedAt: NOW };
}
async function upsert(db, doc, dry) {
  if (!dry) await db.collection("items").updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  // 3/6/9 階梯套裝「焚獄之王」：於火焰兩區受傷遞減 -6% / -10% / -15%（累加）。
  // 用 condition.all 指定「該階所有核心件 + zone」；效果全掛在焰鱗甲(核心，各階都需要)。
  const tierCond = (slots) => ({ all: [...slots.map((s) => ({ equippedItemId: `fire-a-arm-${s}` })), { zone: ZONES }] });
  const setBonus = [
    // 3 件：-6%
    eff("physical_damage_reduction", 6, tierCond(TIER3)),
    eff("magic_damage_reduction", 6, tierCond(TIER3)),
    // 6 件：再 -4%（累計 -10%）
    eff("physical_damage_reduction", 4, tierCond(TIER6)),
    eff("magic_damage_reduction", 4, tierCond(TIER6)),
    // 9 件：再 -5%（累計 -15%）
    eff("physical_damage_reduction", 5, tierCond(TIER9)),
    eff("magic_damage_reduction", 5, tierCond(TIER9)),
  ];

  let items = 0, drops = 0;
  console.log(`火焰裝備套組（dryRun=${dry}）\n` + "=".repeat(90));

  // ---- 武器：A + S ----
  for (const [wt, aName, sName, stats, atk, twoH] of WEAPONS) {
    await upsert(db, weaponDoc(`fire-a-wpn-${wt}`, aName, "A", wt, stats, atk, twoH, [], "A 階火焰武器。頂規標準數值。"), dry);
    await upsert(db, weaponDoc(`fire-s-wpn-${wt}`, sName, "S", wt, stats, atk, twoH, [fdZone(20)],
      "S 階獄焰武器。數值與 A 階同級；於【地獄火焰／焰獄深處】造成傷害 +20%（焚獄特攻）。"), dry);
    items += 2;
    console.log(`  [A] ${aName.padEnd(11)}${wt.padEnd(9)} ${JSON.stringify(stats)}`);
    console.log(`  [S] ${sName.padEnd(11)}${wt.padEnd(9)} ${JSON.stringify(stats)} +焚獄特攻20%`);
  }
  // ---- 防具：只有 A，焰鱗甲帶套裝效果 ----
  for (const [slot, aName, stats] of ARMOR) {
    const desc = slot === "armor"
      ? "A 階火焰防具。【焚獄之王】套裝(需含焰鱗甲)：於地獄火焰／焰獄深處，穿滿 3／6／9 件火焰防具 → 受傷 -6%／-10%／-15%。"
      : "A 階火焰防具。頂規標準數值；為【焚獄之王】9 件套的一部分（穿越多件、火焰區減傷越高）。";
    await upsert(db, armorDoc(`fire-a-arm-${slot}`, aName, slot, stats, slot === "armor" ? setBonus : [], desc), dry);
    items += 1;
    console.log(`  [A] ${aName.padEnd(11)}${slot.padEnd(9)} ${JSON.stringify(stats)}${slot === "armor" ? " +套裝效果[焚獄之王]" : " (套裝件)"}`);
  }

  console.log("-".repeat(90) + "\n掛掉落：");
  // A 武器 → 各基礎怪(對應流派) @1.5%；清掉舊 秘銀/鋼鐵 佔位裝
  for (const [monsterName, wt] of Object.entries(MONSTER_WEAPON)) {
    const m = await db.collection("monsters").findOne({ zone: "hellfire", name: monsterName });
    if (!m) { console.log(`  SKIP 找不到 ${monsterName}`); continue; }
    const d = (m.drops || []).filter((x) => !/^(秘銀|鋼鐵)/.test(x.itemName || ""));
    const wName = WEAPONS.find((w) => w[0] === wt)[1];
    if (!d.find((x) => x.itemId === `fire-a-wpn-${wt}`)) d.push({ itemId: `fire-a-wpn-${wt}`, itemName: wName, chance: 1.5 });
    if (!dry) await db.collection("monsters").updateOne({ _id: m._id }, { $set: { drops: d, updatedAt: NOW } });
    drops++;
    console.log(`  ${monsterName} → ${wName} @1.5%（清舊秘銀/鋼鐵）`);
  }
  // A 防具全套 → 菁英 煉獄烈焰狼王 @2%
  const elite = await db.collection("monsters").findOne({ zone: "hellfire", name: "煉獄烈焰狼王" });
  if (elite) {
    let ed = (elite.drops || []).filter((x) => !/^(秘銀|鋼鐵)/.test(x.itemName || ""));
    for (const [slot, aName] of ARMOR.map((a) => [a[0], a[1]])) {
      if (!ed.find((x) => x.itemId === `fire-a-arm-${slot}`)) ed.push({ itemId: `fire-a-arm-${slot}`, itemName: aName, chance: 2 });
    }
    if (!dry) await db.collection("monsters").updateOne({ _id: elite._id }, { $set: { drops: ed, updatedAt: NOW } });
    drops += ARMOR.length;
    console.log(`  煉獄烈焰狼王 → 火焰A防具全套(${ARMOR.length}件) @2%（清舊秘銀/鋼鐵）`);
  }
  // S 武器(10) → 世界王寶箱池 @weight2；狼牙王卡保留 0.1%
  const boss = await db.collection("monsters").findOne({ id: BOSS_ID });
  const bd = Array.isArray(boss.drops) ? [...boss.drops] : [];
  for (const [wt, , sName] of WEAPONS) if (!bd.find((x) => x.itemId === `fire-s-wpn-${wt}`)) bd.push({ itemId: `fire-s-wpn-${wt}`, itemName: sName, chance: 2 });
  if (!dry) await db.collection("monsters").updateOne({ id: BOSS_ID }, { $set: { drops: bd, updatedAt: NOW } });
  drops += 10;
  console.log(`  地獄狼牙王寶箱池 → 火焰S武器(10把) @weight2（+狼牙王卡0.1%）`);

  console.log("=".repeat(90));
  console.log(`${dry ? "[DRY-RUN] " : ""}完成：裝備 ${items} 件、掉落點 ${drops}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
