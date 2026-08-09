"use strict";
// 事故還原補遺：15 名玩家的升級屬性點（還原時只補了等級/經驗，漏了 2+1 屬性點）。
// 照 progressService 升級迴圈同一套規則：每升 1 級 → 隨機抽 2 次各 +1、statusPoints +1（玩家自行分配）。
// 用法：node scripts/incident-20260809-attrs.js          # dry-run
//       APPLY=1 node scripts/incident-20260809-attrs.js
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const APPLY = process.env.APPLY === "1";
const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];

(async () => {
  const db = await getMongoDb();
  // 事故還原對象＝有 incident-restore 交易紀錄的玩家
  const restored = await db.collection("transactions")
    .find({ source: "admin:incident-restore" }).toArray();
  const pids = [...new Set(restored.map((t) => t.playerId))];
  console.log(`對象 ${pids.length} 名\n`);
  console.log("玩家".padEnd(18) + "Lv".padStart(4) + "  隨機點分佈(2×升級數)" + "  自主點".padStart(8));
  console.log("-".repeat(72));

  for (const pid of pids) {
    const p = await db.collection("progress").findOne({ playerId: pid });
    if (!p) { console.log(pid, "找不到 progress"); continue; }
    const ups = Math.max(0, (p.level || 1) - 1);
    if (ups === 0) { continue; }
    // 防重複執行：已經有點數就跳過
    const attrSum = ATTR_KEYS.reduce((s, k) => s + (p.attributes?.[k] || 1), 0);
    if (attrSum > 6 || (p.statusPoints || 0) > 0) {
      console.log(String(pid).slice(-8).padEnd(18) + "已有點數，跳過（attrs 合計 " + attrSum + "）");
      continue;
    }
    const attrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    for (let i = 0; i < ups * 2; i++) {
      const k = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
      attrs[k] += 1;
    }
    const pl = await db.collection("players").findOne({ discordId: pid }, { projection: { name: 1, nickname: 1 } });
    const name = String(pl?.nickname || pl?.name || pid).slice(0, 14);
    const dist = ATTR_KEYS.map((k) => k.toUpperCase() + (attrs[k] - 1 > 0 ? "+" + (attrs[k] - 1) : "")).filter((x) => x.includes("+")).join(" ");
    console.log(name.padEnd(18) + String(p.level).padStart(4) + "  " + dist.padEnd(34) + String(ups).padStart(6) + " 點");

    if (!APPLY) continue;
    await db.collection("progress").updateOne(
      { playerId: pid },
      { $set: { attributes: attrs, statusPoints: ups, updatedAt: new Date().toISOString() } }
    );
  }
  console.log(`\n${APPLY ? "✅ 已寫入" : "🟡 DRY-RUN（加 APPLY=1 執行）"}`);
  process.exit(0);
})().catch((e) => { console.error("❌", e); process.exit(1); });
