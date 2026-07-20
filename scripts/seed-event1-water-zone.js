"use strict";
/**
 * 期間限定活動區(event_1) 水屬性小怪 seed。
 *
 * 設計基準：強度/經驗值對齊「古城深處(ancient_city_deep)」小怪
 *   對照組 Lv40~45 / HP 19,800~27,158 / EXP 11,550~16,400 / 金幣 324~459
 *
 * 特色：全部帶 element:"water"（新屬性欄位；現有怪維持無屬性 null 不受影響）
 *
 * ⚠️ 全部 enabled:false — 資料先寫滿但玩家看不到，要開活動時到後台把 enabled 打開即可。
 *
 * 可重跑：先刪掉 _event1Seed:true 的舊資料再重建，不會produce重複怪。
 *
 * 用法：
 *   node scripts/seed-event1-water-zone.js            # dry-run，只印出要寫什麼
 *   node scripts/seed-event1-water-zone.js --apply    # 實際寫入
 */

require("dotenv").config();
const { randomUUID } = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONE = "event_1";
const APPLY = process.argv.includes("--apply");

// 掉落用的既有 A 階裝備（與古城深處同 power tier，直接沿用不新增道具）
const D = {
  mithrilMace2h: { itemId: "0635861a-8bb0-4516-b16d-0351539ba5e7", itemName: "秘銀雙手槌" },
  mithrilAxe1h: { itemId: "b24ee5cd-c74b-409e-9326-14bd056d9af8", itemName: "秘銀單手斧" },
  mithrilSword1h: { itemId: "99d23a47-89a6-4291-9b03-8f15e7356eec", itemName: "秘銀單手劍" },
  mithrilBow: { itemId: "bc3d565e-6d15-4080-b79f-b7f0b76e9042", itemName: "秘銀弓" },
  mithrilShield: { itemId: "585ad0b3-2c75-462a-ade6-882e5929831b", itemName: "秘銀盾" },
  mithrilOffhand: { itemId: "afa8d955-ad56-4d49-9ee8-0b845f489997", itemName: "秘銀短匕(副手)" },
  mithrilShoes: { itemId: "mithril-arm-shoes", itemName: "秘銀戰靴" },
  mithrilGarment: { itemId: "mithril-arm-garment", itemName: "秘銀披風" },
  mithrilMagGarment: { itemId: "mithril-mag-garment", itemName: "秘銀法披風" },
  mithrilMagShoes: { itemId: "mithril-mag-shoes", itemName: "秘銀法靴" },
  mithrilMagHead: { itemId: "mithril-mag-head_top", itemName: "秘銀法冠" },
  mithrilMagArmor: { itemId: "mithril-mag-armor", itemName: "秘銀法袍" },
  steelGarment: { itemId: "4359a991-d4ee-4783-b6f3-4aed0d9a1fc5", itemName: "鋼鐵披風" },
  steelShoes: { itemId: "b4b5d9fa-6c55-466d-aa43-64b22837e8b3", itemName: "鋼鐵靴" },
};
const drop = (d, chance) => ({ ...d, chance });

// 怪物圖：先用佔位（沿用既有素材），正式美術由擁有者後補
const PLACEHOLDER_IMG = "/uploads/monsters/hard_06_iceknight.svg";

const MONSTERS = [
  {
    seq: 1, name: "潮汐守衛", level: 41, maxHp: 23000, def: 78,
    str: 45, agi: 6, vit: 26, int: 4, dex: 6, luk: 3,
    expReward: 12520, goldReward: 351, spawnRate: 10,
    dropTheme: { key: "guardian", tags: ["guard", "shield", "armor_piece", "mace_1h", "mace_2h"], note: "守衛/硬殼系偏盾、防具、槌" },
    drops: [drop(D.mithrilShield, 2), drop(D.mithrilMace2h, 2), drop(D.mithrilGarment, 2), drop(D.steelShoes, 2), drop(D.steelGarment, 2)],
  },
  {
    seq: 2, name: "溺影潛伏者", level: 41, maxHp: 19900, def: 44,
    str: 40, agi: 42, vit: 18, int: 5, dex: 20, luk: 12,
    expReward: 12520, goldReward: 351, spawnRate: 10,
    dropTheme: { key: "rogue", tags: ["dagger", "accessory", "shoes"], note: "刺客系偏匕首/飾品/鞋" },
    drops: [drop(D.mithrilOffhand, 2), drop(D.mithrilShoes, 2), drop(D.mithrilMagShoes, 2), drop(D.steelShoes, 2)],
  },
  {
    seq: 3, name: "珊瑚劍士", level: 43, maxHp: 24000, def: 68,
    str: 70, agi: 12, vit: 26, int: 3, dex: 10, luk: 4,
    expReward: 14460, goldReward: 405, spawnRate: 10,
    dropTheme: { key: "duelist", tags: ["sword_1h", "dagger", "armor_piece"], note: "劍鬥系偏劍/匕首/防具" },
    drops: [drop(D.mithrilSword1h, 2), drop(D.mithrilOffhand, 2), drop(D.mithrilGarment, 2), drop(D.mithrilShoes, 2)],
  },
  {
    seq: 4, name: "潮鳴咒師", level: 40, maxHp: 20000, def: 38,
    str: 35, agi: 6, vit: 14, int: 45, dex: 18, luk: 10,
    expReward: 11550, goldReward: 324, spawnRate: 10,
    dropTheme: { key: "hexer", tags: ["staff_1h", "staff_2h", "accessory", "garment"], note: "咒術系偏法杖/飾品/披風" },
    drops: [drop(D.mithrilMagHead, 2), drop(D.mithrilMagArmor, 2), drop(D.mithrilMagGarment, 2), drop(D.mithrilMagShoes, 2)],
  },
  {
    seq: 5, name: "鎧鱗龍人", level: 44, maxHp: 26000, def: 72,
    str: 90, agi: 7, vit: 32, int: 2, dex: 5, luk: 5,
    expReward: 15430, goldReward: 432, spawnRate: 10,
    dropTheme: { key: "berserker", tags: ["axe_1h", "axe_2h", "mace_2h", "armor_piece"], note: "狂斧系偏斧/雙手槌/防具" },
    drops: [drop(D.mithrilAxe1h, 2), drop(D.mithrilMace2h, 2), drop(D.mithrilGarment, 2), drop(D.steelGarment, 2)],
  },
  {
    seq: 6, name: "碧波弓手", level: 42, maxHp: 21500, def: 55,
    str: 30, agi: 15, vit: 20, int: 5, dex: 55, luk: 8,
    expReward: 13490, goldReward: 378, spawnRate: 10,
    dropTheme: { key: "hunter", tags: ["bow", "dagger", "accessory"], note: "遊擊弓系偏弓/匕首/飾品" },
    drops: [drop(D.mithrilBow, 2), drop(D.mithrilOffhand, 2), drop(D.mithrilShoes, 2), drop(D.mithrilMagShoes, 2)],
  },
  {
    seq: 7, name: "寒淵騎士", level: 45, maxHp: 27000, def: 88,
    str: 66, agi: 5, vit: 35, int: 5, dex: 4, luk: 2,
    expReward: 16400, goldReward: 459, spawnRate: 8,
    dropTheme: { key: "guardian", tags: ["guard", "shield", "armor_piece"], note: "守衛/硬殼系偏盾、防具、槌" },
    drops: [drop(D.mithrilShield, 2), drop(D.mithrilMace2h, 2), drop(D.mithrilGarment, 2), drop(D.mithrilShoes, 2), drop(D.steelGarment, 2)],
  },
];

function buildDoc(m) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    zone: ZONE,
    seq: m.seq,
    name: m.name,
    level: m.level,
    maxHp: m.maxHp,
    def: m.def,
    str: m.str, agi: m.agi, vit: m.vit, int: m.int, dex: m.dex, luk: m.luk,
    expReward: m.expReward,
    goldReward: m.goldReward,
    spawnRate: m.spawnRate,
    isBoss: false,
    enabled: false,               // ⚠️ 先不對外
    element: "water",             // 新屬性欄位
    imageUrl: PLACEHOLDER_IMG,
    imageThumbnailUrl: PLACEHOLDER_IMG,
    drops: m.drops,
    passiveEffects: [],
    procEffects: [],
    battleStartEffects: [],
    skills: [],
    dropTheme: m.dropTheme,
    _event1Seed: true,            // 可重跑標記
    createdAt: now,
    updatedAt: now,
  };
}

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  const docs = MONSTERS.map(buildDoc);

  const existing = await col.countDocuments({ zone: ZONE });
  const seeded = await col.countDocuments({ zone: ZONE, _event1Seed: true });

  console.log(`目標 zone: ${ZONE}`);
  console.log(`現有怪物: ${existing} 隻（其中本腳本種的: ${seeded} 隻）\n`);

  console.log("將寫入 7 隻水屬性小怪（全部 enabled:false）：");
  console.log("seq | 名稱         | Lv | HP     | DEF | STR/AGI/VIT/INT/DEX/LUK | EXP   | 金幣 | 掉落");
  docs.forEach((d) => {
    console.log(
      `${String(d.seq).padStart(3)} | ${d.name.padEnd(11)} | ${d.level} | ${String(d.maxHp).padStart(6)} | ${String(d.def).padStart(3)} | ` +
      `${d.str}/${d.agi}/${d.vit}/${d.int}/${d.dex}/${d.luk} | ${String(d.expReward).padStart(5)} | ${String(d.goldReward).padStart(4)} | ${d.drops.length}`
    );
  });

  // seq 撞號防呆：monsterState.activeMonsterSeq 用 seq 定位當前怪，同 zone 撞號會換怪錯亂
  const clash = await col.find({ zone: ZONE, _event1Seed: { $ne: true }, seq: { $in: docs.map((d) => d.seq) } }).toArray();
  if (clash.length) {
    console.error(`\n❌ seq 撞號：zone ${ZONE} 已有非本腳本的怪佔用 seq ${clash.map((c) => c.seq).join(",")}，中止。`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\n(dry-run，未寫入。加 --apply 才會實際寫進 DB)");
    process.exit(0);
  }

  const del = await col.deleteMany({ zone: ZONE, _event1Seed: true });
  const ins = await col.insertMany(docs);
  console.log(`\n✅ 已寫入：刪除舊 seed ${del.deletedCount} 筆、新增 ${ins.insertedCount} 筆`);
  console.log("   全部 enabled:false（玩家看不到）。要開活動時到後台把 enabled 打開。");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
