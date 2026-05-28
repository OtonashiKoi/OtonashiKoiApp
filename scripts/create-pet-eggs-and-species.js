"use strict";
/**
 * 建立寵物系統初始資料：
 *  1. pets collection：5 種龍寵種類定義
 *  2. items collection：對應 5 顆蛋（itemType: pet_egg，可堆疊、可交易）
 *  3. dragon_realm 10 隻怪 drops 加入蛋掉落（一般龍掉 D/C 蛋、BOSS 掉 B/A 蛋）
 *
 * 執行：node scripts/create-pet-eggs-and-species.js [--dry-run]
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

// 寵物種類（rarity 只是圖鑑標示，採集階級由「寵物等級」決定）
const SPECIES = [
  { seq: 1, name: "火苗龍", species: "fire",    rarity: "D", desc: "幼小的火龍，喜歡撿閃亮的東西。" },
  { seq: 2, name: "霜鱗龍", species: "ice",     rarity: "C", desc: "冰原孵化的龍，採集動作俐落。" },
  { seq: 3, name: "雷鳴龍", species: "thunder", rarity: "B", desc: "帶電的龍，找東西特別快。" },
  { seq: 4, name: "黑曜龍", species: "dark",    rarity: "B", desc: "夜行性龍，擅長挖掘稀有素材。" },
  { seq: 5, name: "黃金龍", species: "gold",    rarity: "A", desc: "傳說中的黃金龍，帶來財富。" },
];

// 哪隻怪掉哪種蛋（dragon_realm 怪名 → 蛋對應的 species seq + 掉落機率）
const EGG_DROPS = [
  { monster: "飛龍幼崽",      speciesSeq: 1, chance: 1.5 },
  { monster: "龍蜥武士",      speciesSeq: 1, chance: 1.2 },
  { monster: "火翼龍人",      speciesSeq: 1, chance: 1.2 },
  { monster: "冰鱗龍人",      speciesSeq: 2, chance: 1.2 },
  { monster: "雷霆飛龍",      speciesSeq: 3, chance: 1.0 },
  { monster: "黑曜龍騎",      speciesSeq: 4, chance: 1.0 },
  { monster: "黃金幼龍(稀)",  speciesSeq: 5, chance: 2.0 },  // 稀有種掉黃金蛋機率高
  { monster: "暗影龍將",      speciesSeq: 4, chance: 1.0 },
  { monster: "龍翼魔法師",    speciesSeq: 3, chance: 1.0 },
  { monster: "古龍王(B)",     speciesSeq: 5, chance: 3.0 },  // BOSS 掉黃金蛋
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`建立寵物系統初始資料（dryRun=${dryRun}）`);
  console.log("─".repeat(90));

  // ── 1+2. 建立種類 + 對應蛋 ──
  const speciesIdByseq = {};
  const eggIdBySeq = {};
  for (const sp of SPECIES) {
    // 種類是否已存在（用 name 比對）
    let petDoc = await db.collection("pets").findOne({ name: sp.name });
    let eggItem = await db.collection("items").findOne({ name: `${sp.name}蛋`, itemType: "pet_egg" });

    const eggId = eggItem?.id || crypto.randomUUID();
    const petId = petDoc?.id || crypto.randomUUID();
    speciesIdByseq[sp.seq] = petId;
    eggIdBySeq[sp.seq] = eggId;

    // 蛋 item
    const eggDoc = {
      id: eggId,
      name: `${sp.name}蛋`,
      description: `孵化後可得【${sp.name}】。${sp.desc}`,
      itemType: "pet_egg",
      petId,                          // 蛋對應的寵物種類
      petSpecies: sp.species,
      rarity: sp.rarity,
      stackable: true,
      imageUrl: null,
      imageThumbnailUrl: null,
      effect: { type: "none", value: 0 },
      useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
      equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false,
      atkStat: null, tier: null,
      createdAt: eggItem?.createdAt || NOW,
      updatedAt: NOW,
    };
    // 種類定義
    const petTypeDoc = {
      id: petId,
      seq: sp.seq,
      name: sp.name,
      species: sp.species,
      rarity: sp.rarity,
      description: sp.desc,
      maxLevel: 50,
      eggItemId: eggId,
      imageUrl: null,
      imageThumbnailUrl: null,
      createdAt: petDoc?.createdAt || NOW,
      updatedAt: NOW,
    };

    console.log(`${petDoc ? "UPDATE" : "CREATE"} 種類 ${sp.name.padEnd(8)} (id=${petId.slice(0,8)})  蛋 id=${eggId.slice(0,8)}`);
    if (!dryRun) {
      await db.collection("pets").updateOne({ id: petId }, { $set: petTypeDoc }, { upsert: true });
      await db.collection("items").updateOne({ id: eggId }, { $set: eggDoc }, { upsert: true });
    }
  }

  console.log("─".repeat(90));

  // ── 3. dragon_realm 怪物 drops 加蛋 ──
  let dropAdded = 0;
  for (const ed of EGG_DROPS) {
    const monster = await db.collection("monsters").findOne({ zone: "dragon_realm", name: ed.monster });
    if (!monster) { console.warn(`⚠ 找不到怪物 ${ed.monster}`); continue; }
    const eggId = eggIdBySeq[ed.speciesSeq];
    const eggName = `${SPECIES.find(s => s.seq === ed.speciesSeq).name}蛋`;
    const drops = Array.isArray(monster.drops) ? [...monster.drops] : [];
    const existing = drops.findIndex((d) => d.itemId === eggId);
    const entry = { itemId: eggId, itemName: eggName, chance: ed.chance };
    if (existing >= 0) drops[existing] = entry;
    else drops.push(entry);
    console.log(`DROP  ${ed.monster.padEnd(16)} + ${eggName}@${ed.chance}%`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: monster._id }, { $set: { drops } });
    }
    dropAdded++;
  }

  console.log("─".repeat(90));
  console.log(`完成：種類 ${SPECIES.length}、蛋 ${SPECIES.length}、掉落 ${dropAdded}${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
