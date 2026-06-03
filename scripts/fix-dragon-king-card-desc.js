"use strict";
/**
 * 把「龍王戰意」(龍王(B)卡) 的技能說明從「+數值(STR/DEX/VIT/AGI)」改成實際的「+%」，
 * 與 combatLoop 的實作一致(每次出手 +3% 攻擊、每次受擊 +3% 減傷，各封頂 +15%)。
 * 同步更新道具庫(來源)與既有背包條目(顯示讀條目的 monsterCardSkill.description)。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const CARD_ID = "monster-card-90df79f6-ce40-4f31-be32-f8d4d8f31c99"; // 龍王(B)卡
const NEW_DESC = "[A階 / 龍王系] 常駐：每次出手 攻擊 +3%（最高 +15%）；每次受擊 減傷 +3%（最高 +15%）；另常駐 物理傷害 -15%、魔法傷害 -15%。（戰鬥中逐步疊加，戰報會即時顯示層數）";

(async () => {
  const db = await getMongoDb();

  // 1) 道具庫
  const r1 = await db.collection("items").updateOne(
    { id: CARD_ID, "monsterCardSkill.name": "龍王戰意" },
    { $set: { "monsterCardSkill.description": NEW_DESC } }
  );
  console.log(`道具庫更新: matched=${r1.matchedCount} modified=${r1.modifiedCount}`);

  // 2) 既有背包條目(就地更新該卡的 monsterCardSkill.description)
  const r2 = await db.collection("progress").updateMany(
    { "inventory.itemId": CARD_ID },
    { $set: { "inventory.$[elem].monsterCardSkill.description": NEW_DESC } },
    { arrayFilters: [{ "elem.itemId": CARD_ID, "elem.monsterCardSkill.name": "龍王戰意" }] }
  );
  console.log(`背包條目更新: matched=${r2.matchedCount} modified=${r2.modifiedCount}`);

  // 3) 既有「裝備中」的該卡(equipment slot 物件，逐槽更新)
  let equippedFixed = 0;
  const progs = await db.collection("progress").find({}).project({ _id: 1, equipment: 1 }).toArray();
  for (const p of progs) {
    if (!p.equipment || typeof p.equipment !== "object") continue;
    let changed = false;
    for (const [slot, e] of Object.entries(p.equipment)) {
      if (e && String(e.itemId) === CARD_ID && e.monsterCardSkill?.name === "龍王戰意") {
        e.monsterCardSkill.description = NEW_DESC;
        changed = true;
      }
    }
    if (changed) {
      await db.collection("progress").updateOne({ _id: p._id }, { $set: { equipment: p.equipment } });
      equippedFixed++;
    }
  }
  console.log(`裝備中該卡更新: ${equippedFixed} 位玩家`);

  console.log("完成。");
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
