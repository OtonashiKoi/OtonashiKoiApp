"use strict";
/**
 * 全裝備具名套裝標記（setKeys 複合歸屬）。
 * 規則（依 tier + 名稱系列）：
 *   - 素體裝(非三紋非特效戒)         → [basic_d / basic_c / basic_b / mithril(A)]
 *   - 三紋(迅/鬥/智) 非戒指           → [swift/might/sage]
 *   - 三紋 戒指                       → [紋套, 該階基礎套]   ← 複合
 *   - 特效戒(疾風…戰意)               → [ring_主題, 該階基礎套] ← 複合
 *   - 火焰裝(fire-*)                  → 維持 ["hellfire"]（已標）
 *   - S 階武器/錨點/特殊槽            → 不標（無法計數成套）
 * 可重複執行。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { SET_SLOTS, SET_DEFS } = require("../src/shared/equipmentSetBonuses");
const NOW = new Date().toISOString();

// 歸屬規則：
//   D/C/B → 依 tier 的階級套裝（該階所有防具/武器都算，件數才夠湊 7 件）
//   A     → 依「名稱材質」分套（同 A 階的鋼鐵 / 秘銀是不同套）
//   戒指  → 只算自己的之誓/紋套；秘銀戒指算秘銀套；雜牌戒無套
const BASIC_BY_TIER = { D: "basic_d", C: "basic_c", B: "basic_b" }; // A 不在此(改用名稱)
const MATERIAL_BY_NAME = [
  [/^秘銀/, "mithril"],   // 秘銀套裝（含秘銀戒指）
  [/^鋼鐵/, "steel"],     // 鋼鐵套裝
];
const materialSet = (name) => { for (const [re, k] of MATERIAL_BY_NAME) if (re.test(name || "")) return k; return null; };
const RUNE_MAP = { "迅紋": "swift", "鬥紋": "might", "智紋": "sage" };
const RING_MAP = {
  "疾風": "ring_gale", "獵手": "ring_hunter", "狂血": "ring_frenzy", "吸血": "ring_leech",
  "鏡映": "ring_mirror", "救護": "ring_mercy", "重擊": "ring_smash", "守護": "ring_guard", "戰意": "ring_valor",
};
const SET_NAME = (k) => (SET_DEFS[k] ? SET_DEFS[k].name : k);

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const items = await db.collection("items").find({
    itemType: "equipment",
    equipSlot: { $in: SET_SLOTS },
    tier: { $in: ["D", "C", "B", "A"] },
  }).toArray();

  const stat = {};
  let updated = 0, skipped = 0;
  for (const it of items) {
    if (/^fire-/.test(it.id || "")) { skipped++; continue; } // 火焰已標 hellfire
    const n = it.name || "";
    const isRing = it.equipSlot === "accessory_l" || it.equipSlot === "accessory_r";
    let keys = null;

    const rune = Object.keys(RUNE_MAP).find((p) => n.startsWith(p));
    const ringTheme = Object.keys(RING_MAP).find((p) => n.includes(p));
    if (rune) keys = [RUNE_MAP[rune]];                       // 紋套(armor+ring 都只掛紋套)
    else if (ringTheme && isRing) keys = [RING_MAP[ringTheme]]; // 效果戒只掛自己的之誓套
    else if (isRing) keys = [materialSet(n)];                // 一般戒：秘銀戒指→秘銀套，雜牌戒→無
    else if (it.tier === "A") keys = [materialSet(n)];       // A 階防具/武器：鋼鐵→steel、秘銀→mithril
    else keys = [BASIC_BY_TIER[it.tier]];                    // D/C/B：整階算階級套裝(件數才夠)

    keys = keys.filter(Boolean);
    if (!keys.length) { skipped++; continue; }
    const setName = SET_NAME(keys[0]);
    for (const k of keys) stat[k] = (stat[k] || 0) + 1;
    if (!dry) {
      await db.collection("items").updateOne({ _id: it._id }, { $set: { setKeys: keys, setKey: keys[0], setName, updatedAt: NOW } });
    }
    updated++;
  }
  console.log(`${dry ? "[DRY-RUN] " : ""}標記 ${updated} 件、跳過 ${skipped}（火焰已標）`);
  console.log("各套件數：");
  for (const [k, v] of Object.entries(stat).sort()) console.log(`  ${SET_NAME(k).padEnd(8)}(${k})：${v} 件`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
