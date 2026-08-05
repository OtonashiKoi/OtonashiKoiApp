"use strict";
/**
 * 建立 7 種「屬性石」道具（土火水木金日月）。
 *
 * 定位：寶石類消耗品，**分解帶該屬性的裝備**時有機率獲得（見 shopService 分解流程；
 *       機率依裝備階級 D 25%／C 35%／B 50%／A 65%／S 85%，顆數＝屬性濃度），
 *       之後用於「合成」把裝備的屬性濃度往上推（水1→水2→…）。
 *
 * 設計要點：
 *   ‧ itemType 用 "consumable"（與現有 D~S 階強化寶石同型）——分解流程本來就擋消耗品，
 *     所以屬性石不會被玩家反手分解掉，不必另外加防呆。
 *   ‧ **一定要給 sellPrice**：售價邏輯是「entry.sellPrice > 依 tier 查 TIER_SELL_PRICE」，
 *     若留空又不小心帶到 tier:"A"，會照 A 階裝備賣到 10000 金 → 變金幣機。
 *     這裡明確給 500 且 tier 留 null，兩道都堵住。
 *   ‧ element 欄位是給前端 ElementBadge 顯示用（與怪物/裝備同一套 key）。
 *
 * 用法：
 *   node scripts/seed-element-stones.js            # 試跑，只印不寫
 *   node scripts/seed-element-stones.js --apply    # 實際寫入
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const IMAGE_BASE = "https://otonashikoi.org/item-art/element-stones";

const STONES = [
  { el: "water", label: "水", flavor: "海潮凝成的藍晶，觸手冰涼。" },
  { el: "fire", label: "火", flavor: "餘燼未熄的赤晶，隱隱發燙。" },
  { el: "wood", label: "木", flavor: "纏著生機的翠晶，帶著草木氣息。" },
  { el: "earth", label: "土", flavor: "深岩壓實的褐晶，沉甸甸的。" },
  { el: "metal", label: "金", flavor: "鋒芒內斂的銀晶，邊緣割手。" },
  { el: "sun", label: "日", flavor: "日輪落下的金晶，久看刺眼。" },
  { el: "moon", label: "月", flavor: "月華沉澱的紫晶，泛著微光。" },
];

function buildStone({ el, label, flavor }) {
  return {
    id: `element-stone-${el}`,
    name: `${label}屬性石`,
    description: `${flavor}用於合成，可提升裝備的${label}屬性濃度。分解帶${label}屬性的裝備時有機率取得。`,
    itemType: "consumable",
    tier: null,                       // 不給 tier：避免被 TIER_SELL_PRICE 當高階裝備估價
    element: el,                      // 前端 ElementBadge 依此顯示徽章
    sellPrice: 500,
    effect: { type: "none", value: 0 },
    imageUrl: `${IMAGE_BASE}/${el}.png`,
    imageThumbnailUrl: `${IMAGE_BASE}/${el}.png`,
    equipSlot: null,
    equipStats: null,
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    enhanceLevel: 0,
    useEffects: [],
    passiveEffects: [],
    procEffects: [],
    combatEffects: [],
    _elementStone: true,              // 標記：日後要批次撈/回收找得到
    createdAt: new Date().toISOString(),
  };
}

(async () => {
  const db = await getMongoDb();
  const items = db.collection("items");

  let created = 0;
  let updated = 0;
  for (const spec of STONES) {
    const doc = buildStone(spec);
    const existing = await items.findOne({ id: doc.id });
    if (existing) {
      updated += 1;
      console.log(`  ~ 已存在，更新：${doc.name} (${doc.id})`);
      if (APPLY) {
        const { createdAt, ...rest } = doc;   // 保留原建立時間
        await items.updateOne({ id: doc.id }, { $set: rest });
      }
    } else {
      created += 1;
      console.log(`  + 新增：${doc.name} (${doc.id})  售價 ${doc.sellPrice}  圖 ${doc.imageUrl}`);
      if (APPLY) await items.insertOne(doc);
    }
  }

  console.log(`\n新增 ${created} 筆、更新 ${updated} 筆。${APPLY ? "✅ 已寫入" : "（試跑，未寫入；加 --apply 才會生效）"}`);
  process.exit(0);
})().catch((err) => {
  console.error("失敗：", err.message);
  process.exit(1);
});
