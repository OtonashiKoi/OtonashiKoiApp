"use strict";
/**
 * 幫全部怪物補上 element/elementLevel（純標籤，用於相剋計算，**不開放屬性裝/屬性石掉落**）。
 *
 * 掉落安全性：
 *   ‧ 裝備屬性附魔只在 `isEventZone(zone)`（group:"event"，目前只有 event_1）時才會骰，
 *     其餘區域即使怪物標了 element，掉落的裝備本身仍是素體，不會帶 element 欄位。
 *   ‧ 屬性石只在「分解帶 element 欄位的裝備」時才會出，非活動區掉落的裝備沒有 element 欄位，
 *     所以也不會意外掉出屬性石。
 *   → 這支腳本只動 monsters collection 的 element/elementLevel，兩個掉落開關維持原樣不用碰。
 *
 * event_1（活動區）維持資料庫既有的 水1~3，不在這份清單裡覆寫。
 *
 * 用法：
 *   node scripts/set-monster-elements.js            # 試跑，只印不寫
 *   node scripts/set-monster-elements.js --apply    # 實際寫入
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");

// name → { element, elementLevel }
const ASSIGNMENTS = {
  // ── beginner ──
  "小史(小)": { element: "water", elementLevel: 1 },
  "野兔": { element: "fire", elementLevel: 1 },
  "蘑菇怪": { element: "wood", elementLevel: 1 },
  "小史(中)": { element: "water", elementLevel: 1 },
  "大野兔(B)": { element: "water", elementLevel: 2 },

  // ── normal ──
  "小史": { element: "water", elementLevel: 1 },
  "哥布": { element: "fire", elementLevel: 1 },
  "小狼": { element: "moon", elementLevel: 1 },
  "石頭": { element: "earth", elementLevel: 1 },
  "大史(B)": { element: "water", elementLevel: 2 },
  "小金(稀)": { element: "metal", elementLevel: 2 },
  "青草地精": { element: "wood", elementLevel: 1 },
  "綠野狼": { element: "wood", elementLevel: 2 },

  // ── mid ──
  "甲蟹": { element: "water", elementLevel: 2 },
  "牙牙狼": { element: "fire", elementLevel: 1 },
  "巨巨": { element: "earth", elementLevel: 2 },
  "黑暗弓手": { element: "moon", elementLevel: 2 },
  "米拉桑(B)": { element: "metal", elementLevel: 3 },
  "林地妖靈(樹樹)": { element: "wood", elementLevel: 1 },
  "森林古樹": { element: "wood", elementLevel: 1 },
  "暗夜獵豹": { element: "moon", elementLevel: 1 },
  "森林巫師": { element: "wood", elementLevel: 2 },
  "森林盜賊": { element: "earth", elementLevel: 1 },
  "森林之獸": { element: "wood", elementLevel: 2 },
  "中金(稀)": { element: "metal", elementLevel: 2 },

  // ── ancient_city ──
  "古城弓手": { element: "earth", elementLevel: 2 },
  "石像鬼": { element: "earth", elementLevel: 3 },
  "古城法師": { element: "earth", elementLevel: 2 },
  "廢墟蠍兵": { element: "earth", elementLevel: 1 },
  "詛咒祭司": { element: "earth", elementLevel: 3 },
  "古城刺客": { element: "earth", elementLevel: 2 },
  "毒霧蜘蛛": { element: "earth", elementLevel: 1 },
  "城堡魔像(B)": { element: "earth", elementLevel: 4 },

  // ── ancient_city_deep ──
  "城牆衛兵": { element: "moon", elementLevel: 2 },
  "冰封騎士": { element: "moon", elementLevel: 3 },
  "鐵甲衛將": { element: "moon", elementLevel: 3 },
  "古城狂戰士": { element: "moon", elementLevel: 3 },
  "黑焰巫師": { element: "moon", elementLevel: 2 },
  "古城將軍(B)": { element: "moon", elementLevel: 4 },
  "廢都魔王(B)": { element: "moon", elementLevel: 4 },
  "枯骨劍士": { element: "moon", elementLevel: 3 },
  "古城遊魂弓手": { element: "moon", elementLevel: 3 },
  "魅影潛襲者": { element: "moon", elementLevel: 3 },
  "鏽蝕巨斧兵": { element: "moon", elementLevel: 3 },
  "古城咒術師": { element: "moon", elementLevel: 2 },

  // ── dragon_realm（個別配置，龍種各異）──
  "飛龍幼崽": { element: null, elementLevel: 0 },
  "龍蜥武士": { element: "earth", elementLevel: 2 },
  "火翼龍人": { element: "fire", elementLevel: 2 },
  "冰鱗龍人": { element: "water", elementLevel: 2 },
  "雷霆飛龍": { element: "metal", elementLevel: 2 },
  "黑曜龍騎": { element: "moon", elementLevel: 3 },
  "黃金幼龍(稀)": { element: "sun", elementLevel: 3 },
  "暗影龍將": { element: "moon", elementLevel: 3 },
  "龍翼魔法師": { element: "wood", elementLevel: 3 },
  "龍王(B)": { element: "sun", elementLevel: 4 },

  // ── dragon_king_lair ──
  "古龍王(B)": { element: "moon", elementLevel: 4 },

  // ── elite ──
  "大史王": { element: "water", elementLevel: 4 },

  // ── hellfire ──
  "焰爪幼狼": { element: "fire", elementLevel: 1 },
  "灰燼豺": { element: "fire", elementLevel: 1 },
  "熔岩犬": { element: "fire", elementLevel: 1 },
  "硫火蝙蝠": { element: "fire", elementLevel: 2 },
  "焦炎蜥": { element: "fire", elementLevel: 2 },
  "火髓魔蟲": { element: "fire", elementLevel: 2 },
  "餘燼骷髏": { element: "fire", elementLevel: 3 },
  "炙炎鴉": { element: "fire", elementLevel: 3 },
  "岩漿巨蟲": { element: "fire", elementLevel: 3 },
  "烈焰狼": { element: "fire", elementLevel: 3 },
  "煉獄烈焰狼王(B)": { element: "fire", elementLevel: 4 },

  // ── hellfire_depths ──
  "地獄狼牙王": { element: "fire", elementLevel: 4 },
};

(async () => {
  const db = await getMongoDb();
  const monsters = db.collection("monsters");
  const all = await monsters.find({ zone: { $exists: true, $ne: null, $ne: "" } }).toArray();

  let updated = 0, skipped = 0, notFound = 0;
  const notFoundNames = [];
  const untouched = [];

  for (const m of all) {
    if (m.zone === "event_1") { skipped++; continue; } // 已有既有水1~3，不覆寫
    const spec = ASSIGNMENTS[m.name];
    if (!spec) { notFound++; notFoundNames.push(`${m.zone}/${m.name}`); continue; }

    const willChange = m.element !== spec.element || (m.elementLevel || 0) !== (spec.elementLevel || 0);
    if (!willChange) { untouched.push(m.name); continue; }

    console.log(`  ${m.zone.padEnd(20)} ${m.name.padEnd(12)} → element:${spec.element ?? "null"} level:${spec.elementLevel}`);
    if (APPLY) {
      await monsters.updateOne({ _id: m._id }, { $set: { element: spec.element, elementLevel: spec.elementLevel } });
    }
    updated++;
  }

  console.log(`\n更新 ${updated} 隻、event_1 跳過 ${skipped} 隻、已是目標值不用動 ${untouched.length} 隻`);
  if (notFoundNames.length) console.log(`⚠️ 清單裡沒對到的怪物(${notFound}):`, notFoundNames.join("、"));
  console.log(APPLY ? "\n✅ 已寫入" : "\n（試跑，未寫入；加 --apply 才會生效）");
  process.exit(0);
})().catch((err) => {
  console.error("失敗：", err.message);
  process.exit(1);
});
