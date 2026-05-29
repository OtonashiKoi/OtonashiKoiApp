"use strict";
/**
 * 建立龍族之領（dragon_realm）區的 9 隻一般怪 + 1 BOSS
 * Lv.40-50，掉 A 階秘銀裝備（低機率）
 *
 * 必要：
 *  - zones.js 已加 dragon_realm（minLevel 40, maxLevel 50）
 *  - progression.js MAX_LEVEL 已調為 50
 *
 * 執行：node scripts/create-dragon-realm-zone.js [--dry-run]
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONE = "dragon_realm";
const NOW = new Date().toISOString();

// 怪物設計（HP/EXP/Gold 沿用 15 天平衡曲線往上推，A 階終局區）
const MONSTERS = [
  { seq: 1,  name: "飛龍幼崽",       level: 40, maxHp: 12000, exp: 13000, gold: 6000,  isBoss: false, str: 42, agi: 22, vit: 28, int: 8,  dex: 22, luk: 6, def: 35 },
  { seq: 2,  name: "龍蜥武士",       level: 41, maxHp: 13500, exp: 14000, gold: 6500,  isBoss: false, str: 46, agi: 22, vit: 30, int: 6,  dex: 22, luk: 6, def: 38 },
  { seq: 3,  name: "火翼龍人",       level: 42, maxHp: 15000, exp: 15000, gold: 7000,  isBoss: false, str: 48, agi: 24, vit: 30, int: 14, dex: 24, luk: 7, def: 38 },
  { seq: 4,  name: "冰鱗龍人",       level: 43, maxHp: 16500, exp: 16000, gold: 7500,  isBoss: false, str: 44, agi: 22, vit: 38, int: 16, dex: 22, luk: 7, def: 42 },
  { seq: 5,  name: "雷霆飛龍",       level: 44, maxHp: 18000, exp: 17000, gold: 8000,  isBoss: false, str: 50, agi: 28, vit: 32, int: 14, dex: 26, luk: 8, def: 40 },
  { seq: 6,  name: "黑曜龍騎",       level: 45, maxHp: 20000, exp: 18000, gold: 8500,  isBoss: false, str: 56, agi: 22, vit: 36, int: 8,  dex: 24, luk: 8, def: 44 },
  { seq: 7,  name: "黃金幼龍(稀)",   level: 46, maxHp: 10000, exp: 8000,  gold: 30000, isBoss: true,  str: 40, agi: 30, vit: 24, int: 10, dex: 30, luk: 30, def: 30 }, // 稀有種：低 HP / 高 gold
  { seq: 8,  name: "暗影龍將",       level: 47, maxHp: 23000, exp: 20000, gold: 9500,  isBoss: false, str: 58, agi: 26, vit: 38, int: 12, dex: 28, luk: 9, def: 46 },
  { seq: 9,  name: "龍翼魔法師",     level: 48, maxHp: 25000, exp: 22000, gold: 10000, isBoss: false, str: 36, agi: 24, vit: 32, int: 60, dex: 26, luk: 8, def: 40 },
  { seq: 10, name: "古龍王(B)",      level: 50, maxHp: 100000, exp: 50000, gold: 50000, isBoss: true,  str: 75, agi: 32, vit: 60, int: 30, dex: 32, luk: 14, def: 60 },
];

// A 階純裝備池（從 DB 查到的 ID 寫死）
const A_TIER_POOL = [
  // 武器（11）
  { id: "585ad0b3-2c75-462a-ade6-882e5929831b", name: "秘銀盾" },
  { id: "99d23a47-89a6-4291-9b03-8f15e7356eec", name: "秘銀單手劍" },
  { id: "acfebb62-91b8-4989-8aab-431256ffd202", name: "秘銀雙手劍" },
  { id: "3787b328-db67-4513-950e-0cfb8e503457", name: "秘銀單手槌" },
  { id: "0635861a-8bb0-4516-b16d-0351539ba5e7", name: "秘銀雙手槌" },
  { id: "b24ee5cd-c74b-409e-9326-14bd056d9af8", name: "秘銀單手斧" },
  { id: "8c1782df-9823-405c-ade8-423c854a467e", name: "秘銀雙手斧" },
  { id: "5da1f2b3-ad07-46b5-9d24-eb2d849d3381", name: "秘銀匕首" },
  { id: "bc3d565e-6d15-4080-b79f-b7f0b76e9042", name: "秘銀弓" },
  { id: "1cfe6151-f879-4e94-9fe0-611e15519a9f", name: "秘銀單手法杖" },
  { id: "5947532d-7960-420c-99e7-5bdd02635a0a", name: "秘銀雙手法杖" },
  { id: "afa8d955-ad56-4d49-9ee8-0b845f489997", name: "秘銀短匕(副手)" },
  // 頭防（12）
  { id: "371b770c-e03a-4eaf-b028-d9a5989bc3e5", name: "鋼鐵帽" },
  { id: "af331293-1ade-4da8-a53b-dc0bcdbcf645", name: "迅紋鋼鐵帽" },
  { id: "9d3a61d5-4e98-4ab1-ac47-42f049b6d54a", name: "鬥紋鋼鐵盔" },
  { id: "0139abbe-ea30-4213-9b5a-781b6136ac79", name: "智紋鋼鐵帽" },
  { id: "083da513-8b25-4b33-8932-7405ca9489fa", name: "迅紋鋼鐵護目" },
  { id: "22e3c6e5-fdee-45b7-a9ac-a362d8b2b3ae", name: "鬥紋鋼鐵護目" },
  { id: "195d08bf-fd36-431f-88b7-4a3dbdceac0a", name: "智紋鋼鐵鏡片" },
  { id: "cef73b6e-e86c-4c82-8df7-6831fc03cd11", name: "鋼鐵護目鏡" },
  { id: "5c72b89a-f20c-4df1-b1ce-f6fb7d011eaf", name: "鋼鐵口罩" },
  { id: "9c7b7e3f-bd2e-4056-9b38-4c3dd235670b", name: "迅紋鋼鐵面罩" },
  { id: "6ef4eed9-d62f-4f3b-af22-9ca7488504e0", name: "鬥紋鋼鐵面甲" },
  { id: "c1345f1a-8b68-4ec5-9f14-1b7d4cb39837", name: "智紋鋼鐵口飾" },
  // 身防（4）+ 披風（4）+ 鞋（4）
  { id: "a192dd6c-8de2-4421-a8b3-04e0d60c5041", name: "鋼鐵甲" },
  { id: "0cfdadac-6b8c-4f92-9621-cbc5b6e7281d", name: "迅紋鋼鐵甲" },
  { id: "121cbe5e-5adf-4600-93bb-cb5cf68bd5e7", name: "鬥紋鋼鐵甲" },
  { id: "0d9d737a-15af-4a3f-a62b-2417c44b41b2", name: "智紋鋼鐵袍" },
  { id: "4359a991-d4ee-4783-b6f3-4aed0d9a1fc5", name: "鋼鐵披風" },
  { id: "457fd983-b4f1-48c3-bca4-963bebe1fbb2", name: "迅紋鋼鐵披肩" },
  { id: "bd515bca-77d7-4c6b-a5bc-54fd66ab61d5", name: "鬥紋鋼鐵披肩" },
  { id: "40116efc-f44e-48cd-ab0f-56f63ff838c9", name: "智紋鋼鐵披風" },
  { id: "b4b5d9fa-6c55-466d-aa43-64b22837e8b3", name: "鋼鐵靴" },
  { id: "dd86252c-57b8-49a2-91a3-158b179f59be", name: "迅紋鋼鐵靴" },
  { id: "c20f00f1-e114-4975-a0f9-88347d6e5e81", name: "鬥紋鋼鐵靴" },
  { id: "38f310e3-1959-4717-b031-bae1e390a8db", name: "智紋鋼鐵靴" },
  // 戒指（8）
  { id: "ab7ae63e-f2c9-4d1d-9418-f332f80033ab", name: "迅紋金戒指(左)" },
  { id: "46514870-8bb0-4cf1-a3a4-b13fe158eb29", name: "鬥紋金戒指(左)" },
  { id: "f579720d-08da-446b-b86b-48020a4ccdd2", name: "智紋金戒指(左)" },
  { id: "82c89915-2b11-49bf-8557-e7cd544a86fd", name: "金戒指(左)" },
  { id: "c46e57fe-2636-436c-9e5b-ffca8ee9f9b3", name: "迅紋金戒指(右)" },
  { id: "7be81010-a486-4c77-b912-7e811e94b9d7", name: "鬥紋金戒指(右)" },
  { id: "6979ee0e-f7c2-4b11-805e-0d2fd05fb40f", name: "智紋金戒指(右)" },
  { id: "6041efc9-f493-4e7d-9d78-df8aaa3763a9", name: "金戒指(右)" },
];

// 確定性挑樣：依 seq 偏移挑 n 件，每次取不同子集
function pickDrops(seq, count, chance) {
  const drops = [];
  for (let i = 0; i < count; i++) {
    const item = A_TIER_POOL[(seq * 7 + i * 3) % A_TIER_POOL.length];
    drops.push({ itemId: item.id, itemName: item.name, chance });
  }
  // 去重
  const seen = new Set();
  return drops.filter((d) => { if (seen.has(d.itemId)) return false; seen.add(d.itemId); return true; });
}

function buildMonsterDoc(spec) {
  const dropCount = spec.isBoss && spec.name.includes("古龍王") ? 18
    : spec.isBoss ? 10
    : 6;
  const dropChance = spec.isBoss && spec.name.includes("古龍王") ? 4.5
    : spec.isBoss ? 3.0
    : 1.8; // 一般龍 1.8% 每件，BOSS 3-4.5%

  return {
    id: crypto.randomUUID(),
    seq: spec.seq,
    name: spec.name,
    imageUrl: null,
    imageThumbnailUrl: null,
    str: spec.str, agi: spec.agi, vit: spec.vit, int: spec.int, dex: spec.dex, luk: spec.luk,
    level: spec.level,
    zone: ZONE,
    maxHp: spec.maxHp,
    def: spec.def,
    flatDef: 0,
    defIgnorePct: 0,
    entryFee: 0,
    expReward: spec.exp,
    goldReward: spec.gold,
    participantGoldReward: 0,
    spawnRate: 10,
    isBoss: !!spec.isBoss,
    enabled: true,
    drops: pickDrops(spec.seq, dropCount, dropChance),
    npcMappings: [],
    equipment: {},
    dropTheme: null,
    monsterCardSkill: null,
    passiveEffects: [],
    procEffects: [],
    battleStartEffects: [],
    skills: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  // 防呆：先檢查 zone 是否已有怪
  const existing = await db.collection("monsters").find({ zone: ZONE }).toArray();
  if (existing.length > 0) {
    console.log(`⚠ zone=${ZONE} 已存在 ${existing.length} 隻怪物，先刪除再重建（dryRun=${dryRun}）`);
    if (!dryRun) {
      const ids = existing.map((m) => m._id);
      await db.collection("monsters").deleteMany({ _id: { $in: ids } });
    }
  }

  console.log(`建立 ${MONSTERS.length} 隻 dragon_realm 怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  for (const spec of MONSTERS) {
    const doc = buildMonsterDoc(spec);
    console.log([
      `seq=${doc.seq}`,
      `Lv.${doc.level}`.padEnd(6),
      doc.name.padEnd(16),
      `HP=${doc.maxHp}`.padEnd(13),
      `EXP=${doc.expReward}`.padEnd(12),
      `Gold=${doc.goldReward}`.padEnd(13),
      `drops=${doc.drops.length}件 @${doc.drops[0]?.chance ?? "?"}%`,
      doc.isBoss ? "(B)" : "",
    ].join("  "));
    if (!dryRun) {
      await db.collection("monsters").insertOne(doc);
    }
  }
  console.log("─".repeat(95));
  console.log(`完成${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
