"use strict";
/**
 * 給活動區(event_1) 7 隻水屬性小怪補上「屬性濃度等級」elementLevel。
 *
 * 分級原則：依怪物等級由弱到強配 水1~水3，**水4 保留給未來的活動世界王**
 * （小怪不給滿級，讓王有壓迫感、也留擴充空間）。
 *
 *   Lv40 墨墨章魚        → 水1
 *   Lv41 貝貝寄居蟹/溜溜沙蟹 → 水1
 *   Lv42 鼓鼓河豚        → 水2
 *   Lv43 蝦蝦劍士        → 水2
 *   Lv44 椰椰大蟹        → 水3
 *   Lv45 龜龜大將        → 水3（最強小怪）
 *
 * 意義：怪物的 elementLevel 決定「玩家被牠剋制時的劣勢深度」與日後屬性顯示分級；
 *       玩家自身的相剋倍率則由**玩家武器**的等級決定（見 elementSystem.js）。
 *
 * ⚠️ 只補 elementLevel，不動任何數值/掉落/enabled。
 *
 * 用法：
 *   node scripts/set-event1-element-level.js            # dry-run
 *   node scripts/set-event1-element-level.js --apply    # 實際寫入
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONE = "event_1";
const APPLY = process.argv.includes("--apply");

/** seq → 屬性濃度等級 */
const LEVELS = {
  4: 1,   // 墨墨章魚   Lv40
  1: 1,   // 貝貝寄居蟹 Lv41
  2: 1,   // 溜溜沙蟹   Lv41
  6: 2,   // 鼓鼓河豚   Lv42
  3: 2,   // 蝦蝦劍士   Lv43
  5: 3,   // 椰椰大蟹   Lv44
  7: 3,   // 龜龜大將   Lv45
};

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  const monsters = await col.find({ zone: ZONE, _event1Seed: true }).sort({ level: 1, seq: 1 }).toArray();
  if (monsters.length !== 7) {
    console.error(`❌ 預期 7 隻，實際 ${monsters.length} 隻`);
    process.exit(1);
  }

  console.log("Lv  名稱          目前 → 之後   卡片同步");
  console.log("─".repeat(56));
  const ops = [];
  for (const m of monsters) {
    const lv = LEVELS[m.seq];
    if (!lv) { console.log(`   ${m.name} (seq${m.seq}) 未定義等級，跳過`); continue; }
    const before = m.elementLevel ?? "(未設)";
    console.log(`${String(m.level).padStart(2)}  ${(m.name || "").padEnd(12)} ${String(before).padStart(5)} → 水${lv}      ✓`);
    ops.push({
      updateOne: {
        filter: { id: m.id },
        update: {
          $set: {
            elementLevel: lv,
            // 卡片也帶同樣的屬性濃度（日後卡片若要吃屬性效果才有依據）
            "equipment.special_1.elementLevel": lv,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });
  }

  if (!APPLY) {
    console.log(`\n(dry-run，未寫入。加 --apply 實際套用／共 ${ops.length} 隻)`);
    process.exit(0);
  }
  const r = await col.bulkWrite(ops);
  console.log(`\n✅ 已補上 ${r.modifiedCount} 隻的 elementLevel。數值/掉落/enabled 全部未動。`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
