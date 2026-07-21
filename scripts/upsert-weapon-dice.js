"use strict";
// 骰子武器線（9 件）。屬性曲線與命名／套裝慣例完全對齊 bow：副屬 AGI + 主屬 LUK。
// 骰子是全遊戲唯一以 LUK 為攻擊屬性的武器（賭徒本命），倍率設定在 src/shared/combatStats.js。
// 注意：本季不上架商店，只建資料（下一季再開放取得管道）。
require("dotenv").config();
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const PLACEHOLDER_IMAGE = null; // 圖由使用者自行補

function stats(agi, luk) {
  return { str: 0, agi, vit: 0, int: 0, dex: 0, luk };
}

function zoneFinalDamage(zones, notes) {
  return [{
    key: "final_damage_up",
    target: "self",
    trigger: "passive",
    chance: 100,
    sourcePhase: "passive",
    params: { value: 20 },
    condition: { zone: zones },
    notes,
  }];
}

const DICE_WEAPONS = [
  {
    id: null, name: "木製骰子", tier: "D", equipStats: stats(1, 2),
    description: "D 級 武器", setKey: "basic_d", setName: "新手套裝",
  },
  {
    id: null, name: "鐵製骰子", tier: "C", equipStats: stats(2, 5),
    description: "C 級 武器", setKey: "basic_c", setName: "鐵製套裝",
  },
  {
    id: null, name: "鋼製骰子", tier: "B", equipStats: stats(3, 12),
    description: "B 級 武器", setKey: "basic_b", setName: "鋼製套裝",
  },
  {
    id: null, name: "秘銀骰子", tier: "A", equipStats: stats(4, 19),
    description: "A 階秘銀套裝裝備（物理系）。【秘銀套裝·物】。同時計入 A 階級套裝。",
    setKey: "mithril_p", setName: "秘銀套裝·物",
  },
  {
    id: "fire-a-wpn-dice", name: "焰紋骰子", tier: "A", equipStats: stats(4, 19),
    description: "A 階焚獄套裝裝備（物理系）。【焚獄套裝·物】。同時計入 A 階級套裝。",
    setKey: "hellfire_p", setName: "焚獄套裝·物",
  },
  {
    id: "dragon-a-wpn-dice", name: "亞龍骨骰", tier: "A", equipStats: stats(4, 19),
    description: "以亞龍指骨磨成的骰子，龍族氣息尚淺。",
    setKey: "dragonscale_p", setName: "龍鱗套裝·物",
  },
  {
    id: "mithril-s-wpn-dice", name: "真銀骰子", tier: "S", equipStats: stats(4, 19),
    description: "純化真銀鑄成的銀骰。【真銀特攻】於古城／古城深處／大史王之地，造成傷害 +20%。",
    setKey: "mithril_p", setName: "秘銀套裝·物",
    passiveEffects: zoneFinalDamage(["ancient_city", "ancient_city_deep", "elite"], "古城／古城深處／大史王之地：造成的傷害 +20%"),
  },
  {
    id: "fire-s-wpn-dice", name: "獄焰・炎狼骰", tier: "S", equipStats: stats(4, 19),
    description: "A 階焚獄套裝裝備（物理系）。【焚獄套裝·物】。同時計入 A 階級套裝。",
    setKey: "hellfire_p", setName: "焚獄套裝·物",
    passiveEffects: zoneFinalDamage(["hellfire", "hellfire_depths"], "焚獄特攻"),
  },
  {
    id: "s-dragon-dice", name: "幼龍骨骰", tier: "S", equipStats: stats(4, 19),
    description: "S 階龍系武器。平時與 A 階同級；於【龍族之領／龍王巢穴】造成的傷害 +20%（屠龍特攻）。",
    setKey: "dragonscale_p", setName: "龍鱗套裝·物",
    passiveEffects: zoneFinalDamage(["dragon_realm", "dragon_king_lair"], "龍族之領／龍王巢穴：造成的傷害 +20%"),
  },
];

function toDocument(spec) {
  return {
    id: spec.id || crypto.randomUUID(),
    name: spec.name,
    description: spec.description,
    itemType: "equipment",
    imageUrl: PLACEHOLDER_IMAGE,
    imageThumbnailUrl: PLACEHOLDER_IMAGE,
    effect: { type: "none", value: 0 },
    equipSlot: "weapon",
    equipStats: spec.equipStats,
    weaponType: "dice",
    isTwoHanded: true,   // 骰子是雙手武器（不可配盾/副手）
    atkStat: "luk",
    noPetGather: true,   // ⚠️本季不開放：排除寵物採集池（骰子 setKey 與新手套裝共用，否則會被採集撈到而外洩）
    noDropPool: true,    // 保險：一併標記不進掉落池（下一季開放時再拿掉這兩個旗標）
    tier: spec.tier,
    setKey: spec.setKey,
    setKeys: [spec.setKey],
    setName: spec.setName,
    combatEffects: [],
    passiveEffects: spec.passiveEffects || [],
    procEffects: [],
    useEffects: [],
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  let created = 0;
  let updated = 0;
  for (const spec of DICE_WEAPONS) {
    // 固定 id 的用 id 比對；沒有固定 id 的（basic/秘銀A）用名稱比對，避免重跑時建出重複道具
    const filter = spec.id ? { id: spec.id } : { name: spec.name, weaponType: "dice" };
    const existing = await items.findOne(filter);
    const doc = toDocument(spec);
    if (existing) {
      // 保留既有 id 與圖片（使用者可能已經補過圖）
      delete doc.id;
      if (existing.imageUrl) delete doc.imageUrl;
      if (existing.imageThumbnailUrl) delete doc.imageThumbnailUrl;
      await items.updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date().toISOString() } });
      updated += 1;
      console.log(`  更新 ${spec.tier} ${spec.name}`);
    } else {
      await items.insertOne({ ...doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      created += 1;
      console.log(`  新增 ${spec.tier} ${spec.name} (${doc.id})`);
    }
  }

  console.log(`\n骰子武器完成：新增 ${created} 件、更新 ${updated} 件。`);
  console.log("提醒：本季未上架商店／未加入掉落池，玩家尚無法取得（下一季再開）。");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
