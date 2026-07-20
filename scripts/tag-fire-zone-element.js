"use strict";
/**
 * 把「地獄火焰 / 焰獄深處」的怪標記為火屬性(element:"fire")。
 *
 * 目的：讓活動區的水系內容有剋制對象（水剋火 ×1.3），形成
 *       「打活動區(水) → 拿水系裝備/卡 → 去打火焰區更輕鬆」的動線。
 *
 * ⚠️ 只加 `element` 欄位，**不改任何數值**（HP/攻防/掉落/經驗全部不動）。
 * ⚠️ 目前沒有任何玩家裝備帶 element，故標記後「當下」不會有任何實際變化；
 *    要等水屬性裝備做出來、玩家帶上才會吃到相剋。
 * ⚠️ 含世界王【地獄狼牙王】（依使用者 2026-07-20 決定）——日後水裝普及後，
 *    水系配裝打它會 +30%，屆時要留意傷害排行與難度變化。
 *
 * 範圍刻意**不含**別區的火系怪（古城深處「黑焰巫師」、龍族之領「火翼龍人」），
 * 維持「水↔火」只存在於 活動區↔火焰區 的乾淨動線。
 *
 * 可重跑：以 zone 為準覆寫，重跑結果一致。
 *
 * 用法：
 *   node scripts/tag-fire-zone-element.js            # dry-run
 *   node scripts/tag-fire-zone-element.js --apply    # 實際寫入
 *   node scripts/tag-fire-zone-element.js --revert   # 移除標記(還原)
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZONES = ["hellfire", "hellfire_depths"];
const ELEMENT = "fire";
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  const monsters = await col.find({ zone: { $in: ZONES } }).sort({ zone: 1, seq: 1 }).toArray();

  console.log(`目標 zone: ${ZONES.join(" / ")}（共 ${monsters.length} 隻）\n`);
  console.log("seq | 名稱               | Lv  | 種類     | 目前 element → 之後");
  monsters.forEach((m) => {
    const after = REVERT ? "(移除)" : ELEMENT;
    console.log(
      `${String(m.seq).padStart(3)} | ${(m.name || "").padEnd(17)} | ${String(m.level).padStart(3)} | ` +
      `${(m.isBoss ? "BOSS" : "小怪").padEnd(7)} | ${String(m.element ?? "(無)").padEnd(6)} → ${after}`
    );
  });

  // 安全檢查：確認不會誤傷別區
  const outside = await col.countDocuments({ zone: { $nin: ZONES }, element: ELEMENT });
  console.log(`\n目前別區已被標成 ${ELEMENT} 的怪：${outside} 隻（預期 0）`);

  if (!APPLY && !REVERT) {
    console.log("\n(dry-run，未寫入。加 --apply 寫入 / --revert 還原)");
    process.exit(0);
  }

  const update = REVERT
    ? { $unset: { element: "" }, $set: { updatedAt: new Date().toISOString() } }
    : { $set: { element: ELEMENT, updatedAt: new Date().toISOString() } };
  const r = await col.updateMany({ zone: { $in: ZONES } }, update);
  console.log(`\n✅ ${REVERT ? "已移除" : "已標記"} ${r.modifiedCount} 隻怪的 element。`);
  if (!REVERT) console.log("   數值完全未動；目前無玩家裝備帶屬性，實際戰鬥暫無變化。");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
