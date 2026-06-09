"use strict";
/**
 * 攻塔稽核 LOG 檢視器（唯讀）。
 * 用法：
 *   node scripts/tower-run-log.js            → 最近 5 場
 *   node scripts/tower-run-log.js 10         → 最近 10 場
 *   node scripts/tower-run-log.js <runId>    → 指定某場的逐層明細
 *   node scripts/tower-run-log.js sus        → 只列「有可疑層」的場次
 */
require("dotenv").config();

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const col = db.collection("towerRunLogs");
  const arg = process.argv[2];

  const fmtFloor = (f) => {
    const flag = f.suspicious ? " ⚠️可疑" : "";
    const kill = f.monsterKilled ? "✅殺" : "✗未殺";
    const top = f.topHit != null ? ` 單人最高貢獻=${f.topHit}` : "";
    const md = Array.isArray(f.memberDamage) ? f.memberDamage : [];
    const hardest = md.reduce((mx, m) => ((Number(m.maxHit) || 0) > (Number(mx && mx.maxHit) || 0) ? m : mx), null);
    let hitInfo = "";
    if (hardest && hardest.maxHit) {
      const mult = hardest.atk ? (hardest.maxHit / hardest.atk).toFixed(1) : "?";
      hitInfo = `\n        ↳ 最大單擊 ${hardest.maxHit}（${hardest.name} atk${hardest.atk} → ×${mult}）`;
    }
    return `  F${String(f.floor).padStart(2)} ${f.monster}｜HP ${f.scaledHp}→${f.monsterHpFinal} ${kill}｜行動格 ${f.actions}｜存活 ${f.survivors}/${f.partySize}${top}${flag}${hitInfo}`;
  };
  const printRun = (r, full) => {
    const party = (r.party || []).map((p) => p.name || p.discordId).join("、");
    const head = `\n━━ runId=${r.runId} ｜ ${r.status} ｜ 通關到 ${r.clearedFloor}/${r.totalFloors} ｜ ${r.settledAt}`;
    console.log(head);
    console.log(`   隊伍(${(r.party || []).length})：${party}`);
    if (r.failReason) console.log(`   失敗原因：${r.failReason}`);
    console.log(`   可疑層數：${r.suspiciousCount || 0}`);
    const floors = Array.isArray(r.floors) ? r.floors : [];
    const show = full ? floors : floors.filter((f) => f.suspicious);
    if (full) { for (const f of floors) console.log(fmtFloor(f)); }
    else if (show.length) { console.log("   ⚠️ 可疑層："); for (const f of show) console.log(fmtFloor(f)); }
  };

  if (arg && /^[^\d].*:/.test(arg)) {
    const r = await col.findOne({ runId: arg });
    if (!r) { console.log("找不到該 runId"); process.exit(0); }
    printRun(r, true);
  } else if (arg === "sus") {
    const rows = await col.find({ suspiciousCount: { $gt: 0 } }).sort({ settledAt: -1 }).limit(20).toArray();
    console.log(`有可疑層的場次：${rows.length}`);
    for (const r of rows) printRun(r, false);
  } else {
    const n = Number(arg) || 5;
    const rows = await col.find({}).sort({ settledAt: -1 }).limit(n).toArray();
    console.log(`最近 ${rows.length} 場（只展開有可疑層的；看完整逐層請帶 runId）`);
    for (const r of rows) printRun(r, r.suspiciousCount > 0);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
