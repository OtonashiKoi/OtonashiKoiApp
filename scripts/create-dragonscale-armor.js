"use strict";
/**
 * 龍族之領 專屬「龍鱗」A 防具（9 件，含飾品）+ 龍鱗套裝(dragonscale)。
 * 與地獄火焰「焰鱗」對稱：龍族=連擊/龍區防禦、火焰=傷害/火焰防禦。
 *   - 建 9 件龍鱗 A 防具(數值比照既有 A 防具基準)，setKeys=["dragonscale"]
 *   - 掛進龍族之領各怪掉落(取代其通用鋼鐵防具)，setKeys 複合可再加所屬階級套(此處純龍鱗)
 * 可重複執行(語意 id upsert)。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();
const S6 = (o = {}) => ({ str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0, ...o });

// slot, 名稱, 數值（比照 A 防具基準，與焰鱗同）
const ARMOR = [
  ["armor",       "龍鱗鎧",     { vit: 15 }],
  ["head_top",    "龍首盔",     { vit: 13 }],
  ["shoes",       "龍爪戰靴",   { agi: 5, vit: 8 }],
  ["shield",      "龍鱗盾牌",   { vit: 14 }],
  ["garment",     "龍翼披風",   { agi: 1, vit: 11 }],
  ["head_mid",    "龍瞳護目",   { vit: 9, str: 3 }],
  ["head_low",    "龍頷護面",   { str: 2, vit: 9 }],
  ["accessory_l", "龍紋戒指(左)", { str: 3, luk: 2 }],
  ["accessory_r", "龍紋戒指(右)", { str: 3, vit: 2 }],
];
// 9 件分配到 8 隻龍族怪(飛龍幼崽拿 2 件)
const MONSTER_PIECES = {
  "飛龍幼崽": ["armor", "accessory_l"],
  "龍蜥武士": ["head_top"],
  "火翼龍人": ["shoes"],
  "冰鱗龍人": ["shield"],
  "雷霆飛龍": ["garment"],
  "黑曜龍騎": ["head_mid"],
  "暗影龍將": ["head_low"],
  "龍翼魔法師": ["accessory_r"],
};

function armorDoc(id, name, slot, stats, desc) {
  return { id, name, itemType: "equipment", tier: "A", equipSlot: slot, weaponType: null, isTwoHanded: false,
    atkStat: null, equipStats: S6(stats), effect: { type: "none", value: 0 },
    passiveEffects: [], procEffects: [], combatEffects: [], useEffects: [],
    setKeys: ["dragonscale"], setKey: "dragonscale", setName: "龍鱗套裝",
    imageUrl: null, imageThumbnailUrl: null, description: desc, createdAt: NOW, updatedAt: NOW };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  let items = 0, drops = 0;
  console.log(`龍鱗 A 防具（dryRun=${dry}）\n` + "=".repeat(70));

  // 建 9 件
  for (const [slot, name, stats] of ARMOR) {
    const desc = "A 階龍鱗防具。【龍鱗套裝】：連擊率/連擊傷害 + 於龍族之領/龍王巢穴受傷 -15%（穿 3/5/7 件）。";
    if (!dry) await db.collection("items").updateOne({ id: `dragonscale-arm-${slot}` }, { $set: armorDoc(`dragonscale-arm-${slot}`, name, slot, stats, desc) }, { upsert: true });
    items++;
    console.log(`  ${name.padEnd(12)} ${slot.padEnd(11)} ${JSON.stringify(stats)}`);
  }

  console.log("-".repeat(70) + "\n掛掉落(取代龍族通用鋼鐵防具)：");
  const slotName = Object.fromEntries(ARMOR.map(([s, n]) => [s, n]));
  for (const [mName, slots] of Object.entries(MONSTER_PIECES)) {
    const m = await db.collection("monsters").findOne({ zone: "dragon_realm", name: mName });
    if (!m) { console.log(`  SKIP 找不到 ${mName}`); continue; }
    // 清掉該怪的鋼鐵防具掉落(武器/戒指/寶石保留)
    let d = (m.drops || []).filter((x) => !/鋼鐵/.test(x.itemName || ""));
    for (const slot of slots) {
      const id = `dragonscale-arm-${slot}`;
      if (!d.find((x) => x.itemId === id)) d.push({ itemId: id, itemName: slotName[slot], chance: 1.8 });
      drops++;
    }
    if (!dry) await db.collection("monsters").updateOne({ _id: m._id }, { $set: { drops: d, updatedAt: NOW } });
    console.log(`  ${mName} → ${slots.map((s) => slotName[s]).join("、")} @1.8%（清鋼鐵）`);
  }
  console.log("=".repeat(70));
  console.log(`${dry ? "[DRY-RUN] " : ""}完成：龍鱗防具 ${items} 件、掉落點 ${drops}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
