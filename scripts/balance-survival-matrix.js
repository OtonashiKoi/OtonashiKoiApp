"use strict";
/**
 * V0.5 生存驗收矩陣 —— 職業 × 生存原型 × 世界王，一鍵跑完出紅綠燈報告。
 *
 * 驗收條件（docs/SEASON_NEXT_SURVIVAL_15R_DESIGN.md）：
 *   A. 每個職業至少有一種原型：陣亡率 ≤ 20%（能穩定活過 15 回合）
 *   B. 該生存 build 的輸出 ≥ 同職業「輸出基準」build 的 40%（活著不等於沒用）
 *   C. 重甲 / 閃避 / 回復 每種原型至少 2 個職業可行（原型是真選項，不是紙上談兵）
 *   D. 爆發：單發最痛 ≤ 該 build 血量的 40%（沒有「一擊帶走大半條命」）
 *
 * 可重現性：每一格都用固定種子（seededRandom），同版本程式跑兩次結果位元級相同；
 * 報告存 docs/balance-reports/，同時存 .json 供下次自動 diff。
 *
 * 用法：
 *   node scripts/balance-survival-matrix.js [zoneKey]     # 預設 dragon_king_lair
 *   RUNS=1000 node scripts/balance-survival-matrix.js     # 提高精度（預設 200）
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");
const { withSeed } = require("./lib/seededRandom");
const { JOBS, PRESETS, buildAttrs, buildEquipment, buildExtraOptions } = require("./lib/survivalPresets");

const RUNS = Number(process.env.RUNS) || 200;
const ZONE = process.argv[2] || "dragon_king_lair";
// RESIST=full：防具全插滿「怪物同屬性」石（測七屬性抗性的減免側；預設不插＝承受無抗性懲罰）
const RESIST_MODE = String(process.env.RESIST || "none");
const BASE_PLAYER = "386854676433207318";
const REPORT_DIR = path.join(__dirname, "..", "docs", "balance-reports");

const DEATH_PASS = 0.20;   // A：陣亡率門檻
const OUTPUT_PASS = 0.40;  // B：輸出下限（相對輸出基準）
const BURST_PASS = 0.40;   // D：單發最痛 ≤ 血量 40%
const ARCHETYPES = ["heavy", "dodge", "regen"]; // C 檢查的三原型（護盾線裝備未建，先缺席）

async function main() {
  const t0 = Date.now();
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const sim = await createWorldBossSim(sc, db, ZONE, null, { fresh: true });
  const base = await db.collection("progress").findOne({ playerId: BASE_PLAYER });

  console.log(`\n【生存驗收矩陣】${sim.info}`);
  console.log(`${JOBS.length} 職業 × ${PRESETS.length} 原型 × ${RUNS} 場（種子化，可重現）\n`);

  // ── 跑矩陣 ──────────────────────────────────────────
  const cells = []; // { job, preset, ...stats }
  for (const job of JOBS) {
    const [label, , wt, mainStat] = job;
    for (const preset of PRESETS) {
      const eq = await buildEquipment(items, base.equipment, job, preset);
      if (!eq) { console.log(`  ⚠️ 跳過 ${label}（缺徽章或 S 階 ${wt}）`); break; }
      // 七屬性抗性測試：RESIST=full 時防具依階級洞數插滿怪物同屬性石
      if (RESIST_MODE === "full" && sim.boss.element) {
        const { ARMOR_SLOTS, getElementSocketCapacity } = require("../src/shared/elementSystem");
        for (const slot of ARMOR_SLOTS) {
          const it = eq[slot];
          if (!it) continue;
          const cap = getElementSocketCapacity(it.tier);
          if (cap > 0) eq[slot] = { ...it, elements: { [sim.boss.element]: cap } };
        }
      }
      const attrs = buildAttrs(mainStat, preset);
      const progress = { ...base, attributes: attrs, equipment: eq };
      const extraOptions = buildExtraOptions(job);
      const seed = `survival:${ZONE}:${label}:${preset.key}:${RUNS}`;
      const r = withSeed(seed, () =>
        sim.run(progress, { runs: RUNS, equipment: eq, extraOptions })
      );
      cells.push({ job: label, preset: preset.key, presetLabel: preset.label, ...r });
      process.stdout.write(".");
    }
  }
  console.log(`\n跑完 ${cells.length} 格，耗時 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  // ── 驗收判定 ─────────────────────────────────────────
  const byJob = new Map();
  for (const c of cells) {
    if (!byJob.has(c.job)) byJob.set(c.job, []);
    byJob.get(c.job).push(c);
  }

  const jobVerdicts = [];
  for (const [job, rows] of byJob) {
    const output = rows.find((r) => r.preset === "output");
    const survivors = rows.filter((r) => r.deathRate <= DEATH_PASS);
    // 最佳生存 build：先看活得穩，再看輸出高
    const best = survivors.sort((a, b) => b.avgDmg - a.avgDmg)[0] || rows.sort((a, b) => a.deathRate - b.deathRate)[0];
    const passA = survivors.length > 0;
    const outputRatio = output && output.avgDmg > 0 ? best.avgDmg / output.avgDmg : 0;
    const passB = passA && outputRatio >= OUTPUT_PASS;
    const burstRatio = best.maxHit / Math.max(1, best.maxHp);
    const passD = burstRatio <= BURST_PASS;
    jobVerdicts.push({ job, best, output, passA, passB, passD, outputRatio, burstRatio, survivors: survivors.map((s) => s.preset) });
  }

  const archetypeCoverage = {};
  for (const a of ARCHETYPES) {
    archetypeCoverage[a] = cells.filter((c) => c.preset === a && c.deathRate <= DEATH_PASS).map((c) => c.job);
  }

  // ── 報告 ────────────────────────────────────────────
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  // LABEL=g6 之類的標籤：同一天多次改動各自留檔，不互相覆蓋（例：改 G6 前後對比）
  const LABEL = process.env.LABEL ? `-${process.env.LABEL}` : "";
  const jsonPath = path.join(REPORT_DIR, `${today}-survival-${ZONE}${LABEL}.json`);
  const mdPath = path.join(REPORT_DIR, `${today}-survival-${ZONE}${LABEL}.md`);

  // 找最近一份同 zone 報告做 diff（依檔案修改時間排序——檔名帶 LABEL 時字典序會排錯；排除自己）
  const prevFile = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.includes(`-survival-${ZONE}`) && f.endsWith(".json") && f !== path.basename(jsonPath))
    .sort((a, b) => fs.statSync(path.join(REPORT_DIR, a)).mtimeMs - fs.statSync(path.join(REPORT_DIR, b)).mtimeMs)
    .pop();
  const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(REPORT_DIR, prevFile), "utf8")) : null;

  const fmt = (n) => Math.round(n).toLocaleString();
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const L = [];
  L.push(`# 生存驗收報告 ${today}（${ZONE}）`);
  L.push("");
  L.push(`- 對象：${sim.info}`);
  L.push(`- 規模：${JOBS.length} 職業 × ${PRESETS.length} 原型 × ${RUNS} 場（種子化，可重現）`);
  L.push(`- 抗性世界：RESIST=${RESIST_MODE}${RESIST_MODE === "none" ? "（沒插石，承傷 +15%）" : "（防具插滿同屬性石，滿抗 −35%）"}——跨報告比較務必對齊此欄！`);
  L.push(`- 產生：\`node scripts/balance-survival-matrix.js ${ZONE}\`（RUNS=${RUNS}）`);
  L.push("");

  L.push(`## 總驗收`);
  const failA = jobVerdicts.filter((v) => !v.passA);
  const failB = jobVerdicts.filter((v) => v.passA && !v.passB);
  const failD = jobVerdicts.filter((v) => !v.passD);
  const failC = ARCHETYPES.filter((a) => archetypeCoverage[a].length < 2);
  L.push("");
  L.push(`| 條件 | 結果 | 說明 |`);
  L.push(`|---|---|---|`);
  L.push(`| A. 每職業有活法（陣亡 ≤${pct(DEATH_PASS)}） | ${failA.length === 0 ? "🟢 通過" : `🔴 ${failA.length} 職業不過`} | ${failA.map((v) => v.job).join("、") || "全數通過"} |`);
  L.push(`| B. 生存 build 輸出 ≥${pct(OUTPUT_PASS)} | ${failB.length === 0 ? "🟢 通過" : `🔴 ${failB.length} 職業不過`} | ${failB.map((v) => `${v.job}(${pct(v.outputRatio)})`).join("、") || "全數通過"} |`);
  L.push(`| C. 三原型各 ≥2 職業可行 | ${failC.length === 0 ? "🟢 通過" : `🔴 缺 ${failC.join("、")}`} | ${ARCHETYPES.map((a) => `${a}:${archetypeCoverage[a].length}職業`).join("｜")} |`);
  L.push(`| D. 單發最痛 ≤${pct(BURST_PASS)} 血量 | ${failD.length === 0 ? "🟢 通過" : `🔴 ${failD.length} 職業不過`} | ${failD.map((v) => `${v.job}(${pct(v.burstRatio)})`).join("、") || "全數通過"} |`);
  L.push("");

  L.push(`## 各職業判定（最佳生存 build）`);
  L.push("");
  L.push(`| 職業 | 最佳原型 | 存活回合 | 陣亡率 | 均傷 | 相對輸出基準 | 最痛一擊/血量 | A | B | D |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const v of jobVerdicts) {
    const b = v.best;
    L.push(`| ${v.job} | ${b.presetLabel} | ${b.avgRounds.toFixed(1)} | ${pct(b.deathRate)} | ${fmt(b.avgDmg)} | ${pct(v.outputRatio)} | ${fmt(b.maxHit)}/${fmt(b.maxHp)}＝${pct(v.burstRatio)} | ${v.passA ? "🟢" : "🔴"} | ${v.passB ? "🟢" : "🔴"} | ${v.passD ? "🟢" : "🔴"} |`);
  }
  L.push("");

  L.push(`## 原型覆蓋（條件 C）`);
  L.push("");
  for (const a of ARCHETYPES) {
    const label = PRESETS.find((p) => p.key === a)?.label || a;
    L.push(`- **${label}**（${archetypeCoverage[a].length} 職業可行）：${archetypeCoverage[a].join("、") || "無"}`);
  }
  L.push(`- 護盾原型：本季無護盾裝備線，暫缺席（設計文件附錄 A）`);
  L.push("");

  L.push(`## 完整矩陣`);
  L.push("");
  L.push(`| 職業 | 原型 | ATK | 血量 | 存活回合 | 陣亡率 | 均傷 | 均承傷 | 最痛一擊 |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const c of cells) {
    L.push(`| ${c.job} | ${c.presetLabel} | ${c.atk} | ${fmt(c.maxHp)} | ${c.avgRounds.toFixed(1)} | ${pct(c.deathRate)} | ${fmt(c.avgDmg)} | ${fmt(c.avgTaken)} | ${fmt(c.maxHit)} |`);
  }
  L.push("");

  L.push(`## 陣亡率分佈（KDA 免責門檻校準用）`);
  L.push("");
  const drs = jobVerdicts.map((v) => v.best.deathRate).sort((a, b) => a - b);
  const median = drs[Math.floor(drs.length / 2)];
  L.push(`- 最佳生存 build 陣亡率：最低 ${pct(drs[0])}｜中位 ${pct(median)}｜最高 ${pct(drs[drs.length - 1])}`);
  L.push(`- KDA 免責門檻建議 ＝ 中位數上緣（現值參考：${pct(median)}；設計文件假設 ~10%）`);
  L.push("");

  if (prev) {
    L.push(`## 與上次報告差異（${prevFile}）`);
    L.push("");
    const prevMap = new Map(prev.cells.map((c) => [`${c.job}|${c.preset}`, c]));
    const diffs = [];
    for (const c of cells) {
      const p = prevMap.get(`${c.job}|${c.preset}`);
      if (!p) { diffs.push(`- ➕ 新格子：${c.job} × ${c.presetLabel}`); continue; }
      const dDmg = p.avgDmg > 0 ? c.avgDmg / p.avgDmg - 1 : 0;
      const dDeath = c.deathRate - p.deathRate;
      if (Math.abs(dDmg) >= 0.02 || Math.abs(dDeath) >= 0.02) {
        diffs.push(`- ${c.job} × ${c.presetLabel}：均傷 ${fmt(p.avgDmg)}→${fmt(c.avgDmg)}（${dDmg >= 0 ? "+" : ""}${(dDmg * 100).toFixed(1)}%）｜陣亡 ${pct(p.deathRate)}→${pct(c.deathRate)}`);
      }
    }
    L.push(diffs.length ? diffs.join("\n") : "- 無顯著差異（均傷 ±2%、陣亡率 ±2pt 內）");
    L.push("");
  }

  fs.writeFileSync(mdPath, L.join("\n"));
  fs.writeFileSync(jsonPath, JSON.stringify({ date: today, zone: ZONE, runs: RUNS, info: sim.info, cells, jobVerdicts, archetypeCoverage }, null, 1));

  // 終端摘要
  console.log(`驗收：A ${failA.length === 0 ? "🟢" : `🔴(${failA.map((v) => v.job).join("、")})`}｜B ${failB.length === 0 ? "🟢" : `🔴(${failB.length})`}｜C ${failC.length === 0 ? "🟢" : `🔴缺${failC.join("、")}`}｜D ${failD.length === 0 ? "🟢" : `🔴(${failD.length})`}`);
  console.log(`報告：${mdPath}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
