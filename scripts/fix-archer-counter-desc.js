"use strict";
/**
 * 拿掉弓箭手徽章 counter_on_dodge 敘述裡「（反擊必定會心/爆擊）」字樣。
 * PvE 的閃避反擊未套用必定爆擊(僅普通傷害)，描述會誤導，故移除該句。
 * 「迴避→還擊」核心機制本身正常,不受影響。
 * 同步更新道具庫(裝備中的徽章會從庫即時刷新)與既有背包/裝備存檔副本。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const BADGE_ID = "job_archer_v1";
const EFFECT_KEY = "counter_on_dodge";
const NEW_NOTES = "主武為弓時：在迴避怪物攻擊後進行反擊";

function patchEffectsArray(arr) {
  if (!Array.isArray(arr)) return false;
  let changed = false;
  for (const e of arr) {
    if (e && e.key === EFFECT_KEY && e.notes !== NEW_NOTES) {
      e.notes = NEW_NOTES;
      changed = true;
    }
  }
  return changed;
}

(async () => {
  const db = await getMongoDb();

  // 1) 道具庫
  const r1 = await db.collection("items").updateOne(
    { id: BADGE_ID },
    { $set: { "passiveEffects.$[e].notes": NEW_NOTES } },
    { arrayFilters: [{ "e.key": EFFECT_KEY }] }
  );
  console.log(`道具庫更新: matched=${r1.matchedCount} modified=${r1.modifiedCount}`);

  // 2) 既有背包/裝備存檔副本
  const progs = await db.collection("progress").find({}).project({ _id: 1, equipment: 1, inventory: 1 }).toArray();
  let invFixed = 0, eqFixed = 0;
  for (const p of progs) {
    let changed = false;
    if (Array.isArray(p.inventory)) {
      for (const it of p.inventory) {
        if (it && String(it.itemId) === BADGE_ID && patchEffectsArray(it.passiveEffects)) { changed = true; invFixed++; }
      }
    }
    if (p.equipment && typeof p.equipment === "object") {
      for (const e of Object.values(p.equipment)) {
        if (e && String(e.itemId) === BADGE_ID && patchEffectsArray(e.passiveEffects)) { changed = true; eqFixed++; }
      }
    }
    if (changed) {
      await db.collection("progress").updateOne({ _id: p._id }, { $set: { equipment: p.equipment, inventory: p.inventory } });
    }
  }
  console.log(`存檔副本更新: 背包 ${invFixed} 件、裝備中 ${eqFixed} 件`);
  console.log("完成。");
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
