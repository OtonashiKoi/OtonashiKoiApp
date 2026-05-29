require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

// HP 派生公式
const HP_PER_LEVEL = 800;
const HP_PER_VIT = 200;
const BOSS_MULT = 3;
const WORLD_BOSS_MULT = 5;       // 廢都魔王
const ELITE_KING_MULT = 20;      // 大史王

function calcHp(level, vit, mult = 1) {
  return Math.round((level * HP_PER_LEVEL + vit * HP_PER_VIT) * mult);
}

// 新怪物配置（zone + level + bossMult）
// beginner 不 +5；其他全部 +5
const PLAN = [
  // ── beginner（Lv.1-5，不動）──
  { name: "小史(小)", zone: "beginner", level: 1, mult: 1 },
  { name: "野兔", zone: "beginner", level: 2, mult: 1 },
  { name: "蘑菇怪", zone: "beginner", level: 3, mult: 1 },
  { name: "小史(中)", zone: "beginner", level: 4, mult: 1 },
  { name: "大野兔(B)", zone: "beginner", level: 5, mult: BOSS_MULT },

  // ── normal（Lv.10-15，+5）──
  { name: "小史", zone: "normal", level: 10, mult: 1 },
  { name: "哥布", zone: "normal", level: 11, mult: 1 },
  { name: "小狼", zone: "normal", level: 11, mult: 1 },
  { name: "石頭", zone: "normal", level: 12, mult: 1 },
  { name: "青草地精", zone: "normal", level: 12, mult: 1 },
  { name: "綠野狼", zone: "normal", level: 13, mult: 1 },
  { name: "小金(稀)", zone: "normal", level: 13, mult: BOSS_MULT },
  { name: "大史(B)", zone: "normal", level: 15, mult: BOSS_MULT },

  // ── mid（Lv.15-23，+5）──
  { name: "暗夜獵豹", zone: "mid", level: 15, mult: 1 },
  { name: "林地妖靈(樹樹)", zone: "mid", level: 16, mult: 1 },
  { name: "森林古樹", zone: "mid", level: 17, mult: 1 },
  { name: "森林盜賊", zone: "mid", level: 17, mult: 1 },
  { name: "森林巫師", zone: "mid", level: 18, mult: 1 },
  { name: "牙牙狼", zone: "mid", level: 18, mult: 1 },
  { name: "甲蟹", zone: "mid", level: 19, mult: 1 },
  { name: "森林之獸", zone: "mid", level: 20, mult: 1 },
  { name: "黑暗弓手", zone: "mid", level: 21, mult: 1 },
  { name: "巨巨", zone: "mid", level: 21, mult: 1 },
  { name: "中金(稀)", zone: "mid", level: 22, mult: BOSS_MULT },
  { name: "米拉桑(B)", zone: "mid", level: 23, mult: BOSS_MULT },

  // ── ancient_city（Lv.25-35，+5）──
  { name: "廢墟蠍兵", zone: "ancient_city", level: 25, mult: 1 },
  { name: "毒霧蜘蛛", zone: "ancient_city", level: 27, mult: 1 },
  { name: "古城弓手", zone: "ancient_city", level: 28, mult: 1 },
  { name: "古城法師", zone: "ancient_city", level: 29, mult: 1 },
  { name: "古城刺客", zone: "ancient_city", level: 31, mult: 1 },
  { name: "石像鬼", zone: "ancient_city", level: 32, mult: 1 },
  { name: "詛咒祭司", zone: "ancient_city", level: 33, mult: 1 },
  { name: "城堡魔像(B)", zone: "ancient_city", level: 35, mult: BOSS_MULT },

  // ── ancient_city_deep（Lv.37-55，+5）──
  { name: "黑焰巫師", zone: "ancient_city_deep", level: 37, mult: 1 },
  { name: "城牆衛兵", zone: "ancient_city_deep", level: 39, mult: 1 },
  { name: "古城狂戰士", zone: "ancient_city_deep", level: 41, mult: 1 },
  { name: "鐵甲衛將", zone: "ancient_city_deep", level: 43, mult: 1 },
  { name: "冰封騎士", zone: "ancient_city_deep", level: 45, mult: 1 },
  { name: "古城將軍(B)", zone: "ancient_city_deep", level: 50, mult: BOSS_MULT },
  { name: "廢都魔王(B)", zone: "ancient_city_deep", level: 55, mult: WORLD_BOSS_MULT },

  // ── elite（Lv.60，+5）──
  { name: "大史王", zone: "elite", level: 60, mult: ELITE_KING_MULT },
];

async function main() {
  const db = await getMongoDb();
  const allMonsters = await db.collection("monsters").find({}).toArray();
  const monsters = allMonsters.filter((m) => !String(m._id || "").startsWith("monsterState:"));
  const byName = new Map(monsters.map((m) => [m.name, m]));

  console.log(`\n═══ 怪物 rebalance（${PLAN.length} 隻）═══\n`);
  console.log("─".repeat(110));
  console.log(["區".padEnd(20), "Lv", "名稱".padEnd(16), "VIT", "舊HP", "→", "新HP", "倍率"].join("  "));
  console.log("─".repeat(110));

  let updated = 0;
  for (const entry of PLAN) {
    const m = byName.get(entry.name);
    if (!m) {
      console.log(`⚠️  找不到 ${entry.name}`);
      continue;
    }
    const newHp = calcHp(entry.level, m.vit || 0, entry.mult);
    console.log([
      entry.zone.padEnd(20),
      String(entry.level).padStart(2),
      entry.name.padEnd(16),
      String(m.vit || 0).padStart(3),
      String(m.maxHp).padStart(7),
      "→",
      String(newHp).padStart(7),
      `×${entry.mult}`,
    ].join("  "));
    await db.collection("monsters").updateOne(
      { _id: m._id },
      {
        $set: {
          zone: entry.zone,
          level: entry.level,
          maxHp: newHp,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    updated++;
  }

  console.log("─".repeat(110));
  console.log(`✅ 更新 ${updated} 隻怪物`);

  // 順便清理 monsterState（active monster 可能會 stale）
  const states = await db.collection("monsterState").find({}).toArray();
  for (const s of states) {
    await db.collection("monsterState").updateOne(
      { _id: s._id },
      { $set: { activeMonsterSeq: null, currentHp: null, participants: [], damageMap: {}, updatedAt: new Date().toISOString() } }
    );
  }
  console.log(`✅ 重置 ${states.length} 個 monsterState（讓系統重新選怪）`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
