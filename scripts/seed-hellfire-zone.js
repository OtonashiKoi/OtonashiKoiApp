// 建立「地獄火焰」zone 的怪物：10 基礎 + 1 菁英 + 1 世界王(地獄狼牙王)。
// 強度接續 V0.4 曲線：龍族之領 ~40k 綜合戰力 → 本區基礎 ~90k(約+125%)。
// 綜合戰力 = HP×0.5 + STR×10 + DEF×5。世界王 spawnRate:0(需另接 worldBoss 框架才會真正出現)。
require("dotenv").config();
const { randomUUID } = require("crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const GEM_A = "a6ae293d-52fc-4af5-8770-891ddf842e35";
const GEM_S = "gem-s-tier";
const A_SWORD = "99d23a47-89a6-4291-9b03-8f15e7356eec";
const A_SHIELD = "585ad0b3-2c75-462a-ade6-882e5929831b";
const A_BOW = "bc3d565e-6d15-4080-b79f-b7f0b76e9042";
const A_STAFF = "1cfe6151-f879-4e94-9fe0-611e15519a9f";
const A_HELM = "371b770c-e03a-4eaf-b028-d9a5989bc3e5";

const drops = (extra = []) => ([
  { itemId: GEM_A, itemName: "A階寶石", chance: 2.5 },
  { itemId: GEM_S, itemName: "S階寶石", chance: 1.0 },
  ...extra
]);

// [name, level, maxHp, str, def, agi, vit, dex, exp, gold, spawnRate, dropsExtra]
const BASIC = [
  ["焰爪幼狼", 50, 150000, 190, 150, 45, 40, 40, 30000, 3500, 10, [{ itemId: A_SWORD, itemName: "秘銀單手劍", chance: 1.5 }]],
  ["灰燼豺",   51, 160000, 200, 155, 50, 42, 40, 32000, 3700, 10, [{ itemId: A_SHIELD, itemName: "秘銀盾", chance: 1.5 }]],
  ["熔岩犬",   52, 175000, 210, 160, 48, 45, 42, 35000, 4000, 10, [{ itemId: A_HELM, itemName: "鋼鐵帽", chance: 1.5 }]],
  ["硫火蝙蝠", 52, 155000, 230, 140, 60, 38, 46, 33000, 3800, 10, [{ itemId: A_BOW, itemName: "秘銀弓", chance: 1.5 }]],
  ["焦炎蜥",   53, 180000, 205, 170, 46, 50, 42, 36000, 4100, 9,  [{ itemId: A_STAFF, itemName: "秘銀單手法杖", chance: 1.5 }]],
  ["火髓魔蟲", 54, 200000, 195, 175, 44, 55, 40, 40000, 4300, 9,  [{ itemId: A_SHIELD, itemName: "秘銀盾", chance: 1.5 }]],
  ["餘燼骷髏", 54, 165000, 240, 150, 52, 44, 48, 37000, 4200, 9,  [{ itemId: A_SWORD, itemName: "秘銀單手劍", chance: 1.5 }]],
  ["炙炎鴉",   55, 158000, 250, 145, 65, 40, 50, 38000, 4300, 9,  [{ itemId: A_BOW, itemName: "秘銀弓", chance: 1.5 }]],
  ["岩漿巨蟲", 56, 210000, 215, 185, 44, 58, 42, 42000, 4600, 8,  [{ itemId: A_HELM, itemName: "鋼鐵帽", chance: 1.5 }]],
  ["烈焰狼",   58, 190000, 260, 175, 62, 50, 52, 45000, 4800, 8,  [{ itemId: A_STAFF, itemName: "秘銀單手法杖", chance: 1.5 }]],
];

const power = (hp, str, def) => hp * 0.5 + str * 10 + def * 5;

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  await col.deleteMany({ zone: "hellfire", _hellfireSeed: true }); // 可重跑：先清掉本腳本建過的

  const docs = [];
  BASIC.forEach(([name, level, maxHp, str, def, agi, vit, dex, exp, gold, spawn, extra], i) => {
    docs.push({
      id: randomUUID(), seq: i + 1, name, imageUrl: null, imageThumbnailUrl: null,
      str, agi, vit, int: 15, dex, luk: 15, level, zone: "hellfire",
      maxHp, def, flatDef: 0, defIgnorePct: 0,
      entryFee: 0, expReward: exp, goldReward: gold, participantGoldReward: 0,
      spawnRate: spawn, isBoss: false, enabled: true, drops: drops(extra),
      _hellfireSeed: true, createdAt: new Date().toISOString()
    });
  });
  // 菁英
  docs.push({
    id: randomUUID(), seq: 11, name: "煉獄烈焰狼王", imageUrl: null, imageThumbnailUrl: null,
    str: 400, agi: 70, vit: 80, int: 20, dex: 60, luk: 20, level: 59, zone: "hellfire",
    maxHp: 450000, def: 280, flatDef: 20, defIgnorePct: 0,
    entryFee: 0, expReward: 90000, goldReward: 12000, participantGoldReward: 0,
    spawnRate: 3, isBoss: false, enabled: true,
    drops: [{ itemId: GEM_S, itemName: "S階寶石", chance: 3 }, { itemId: GEM_A, itemName: "A階寶石", chance: 4 }, { itemId: A_SWORD, itemName: "秘銀單手劍", chance: 3 }, { itemId: A_SHIELD, itemName: "秘銀盾", chance: 3 }],
    _hellfireSeed: true, createdAt: new Date().toISOString()
  });
  // 世界王（spawnRate:0，需另接 worldBoss 框架；先建 doc）
  docs.push({
    id: randomUUID(), seq: 12, name: "地獄狼牙王", imageUrl: null, imageThumbnailUrl: null,
    str: 95, agi: 40, vit: 100, int: 30, dex: 45, luk: 25, level: 60, zone: "hellfire",
    maxHp: 2000000, def: 70, flatDef: 30, defIgnorePct: 0,
    entryFee: 0, expReward: 200000, goldReward: 30000, participantGoldReward: 500,
    spawnRate: 0, isBoss: true, enabled: true,
    drops: [{ itemId: GEM_S, itemName: "S階寶石", chance: 100 }],
    _hellfireSeed: true, createdAt: new Date().toISOString()
  });

  await col.insertMany(docs);

  // 驗證
  const basics = docs.filter((d) => !d.isBoss && d.spawnRate > 0 && d.seq <= 10);
  const avg = basics.reduce((s, d) => s + power(d.maxHp, d.str, d.def), 0) / basics.length;
  console.log(`✅ 建立 ${docs.length} 隻（10基礎+1菁英+1世界王）`);
  console.log(`地獄火焰 基礎怪平均綜合戰力 ≈ ${Math.round(avg)}（龍族之領 ~40,055，約 +${Math.round((avg / 40055 - 1) * 100)}%）`);
  console.log(`菁英 煉獄烈焰狼王 綜合 ≈ ${Math.round(power(450000, 400, 280))}`);
  console.log(`世界王 地獄狼牙王 HP 200萬（spawnRate:0，待接 worldBoss 框架）`);
  process.exit(0);
})().catch((e) => { console.error("錯誤:", e); process.exit(1); });
