// 模擬器覆蓋檢查 —— 確認「每個職業徽章的每個機制，平衡腳本都真的餵進去了」。
// ------------------------------------------------------------------
// 為什麼要有這支（2026-08-05）：
//   平衡腳本各自手拼 runCombatLoop 的 options，同一類漏接反覆發生四次
//   （自我光環漏三支、二轉身分技整組沒餵）。結果是「排行看起來很準，其實職業沒放技能」。
//   這支把它變成可自動偵測的錯誤，而不是靠人記得。
//
// 用法：node scripts/check-sim-coverage.js
// 退出碼 1 = 有漏接（可掛進 npm run check）
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const jbo = require("./lib/jobBattleOptions");
const jobAdvancement = require("../src/shared/jobAdvancement");

(async () => {
  const missingT2Bases = Object.keys(jobAdvancement.BASE_JOBS)
    .filter((baseKey) => jobAdvancement.getBranchesForBase(baseKey).length === 0);
  if (missingT2Bases.length > 0) {
    throw new Error(`一轉缺少二轉分支：${missingT2Bases.join(", ")}`);
  }

  const db = await getMongoDb();
  const badges = await db.collection("items").find({ itemType: "job_badge" }).toArray();
  const attrs = { str: 20, agi: 20, vit: 20, int: 20, dex: 20, luk: 20 };

  let bad = 0;
  let checked = 0;
  const rows = [];

  for (const badge of badges) {
    const equipped = { job_eq: { ...badge, itemId: badge.id } };
    const pStats = calcPlayerStats(attrs, equipped, [], [], {});
    const opts = jbo.buildBattleOptions({ equipped, pStats });
    const mechanics = jbo.detectMechanics(equipped);
    const derived = jbo.EQUIPPED_DERIVED.filter((d) => { try { return d.detect(badge); } catch (_) { return false; } });
    const audit = jbo.auditCoverage(equipped, opts);
    checked += 1;
    if (!audit.ok) bad += 1;
    rows.push({
      name: badge.name,
      t2: /_t2_/.test(badge.id),
      mechanics: mechanics.map((m) => m.name),
      derived: derived.map((d) => d.name),
      fed: Object.keys(opts).filter((k) => k !== "zoneComboCount"),
      missing: audit.missing,
    });
  }

  console.log("═══ 模擬器職業機制覆蓋檢查 ═══\n");
  for (const r of rows.sort((a, b) => Number(b.t2) - Number(a.t2))) {
    const tag = r.t2 ? "[二轉]" : "[一轉]";
    const all = [...r.mechanics, ...r.derived.map((d) => `${d}(裝備推導)`)];
    const mech = all.length ? all.join("、") : "（無特殊機制）";
    const mark = r.missing.length ? "❌" : "✅";
    console.log(`${mark} ${tag} ${r.name.padEnd(12)} 機制：${mech}`);
    if (r.fed.length) console.log(`        餵入：${r.fed.join(", ")}`);
    for (const m of r.missing) console.log(`        ⚠️ 漏接：${m.mechanic} → options.${m.option}`);
  }

  console.log(`\n${Object.keys(jobAdvancement.BASE_JOBS).length} 個一轉皆有二轉；檢查 ${checked} 個徽章，${bad} 個有漏接。`);
  if (bad > 0) {
    console.log("→ 修法：在 scripts/lib/jobBattleOptions.js 的 MECHANIC_MAP 補上對應，並確認 buildBattleOptions 有填值。");
    process.exit(1);
  }
  console.log("✅ 全部機制都有對應的 options 被餵入。");
  process.exit(0);
})().catch((e) => { console.error("❌ 檢查失敗：", e.message); process.exit(1); });
