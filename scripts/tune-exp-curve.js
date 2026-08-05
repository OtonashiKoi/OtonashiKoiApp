"use strict";
/**
 * 反解升等曲線：給定「每段想花幾小時」，回推每級所需經驗。
 *
 * 作法：
 *   ① 讀 measure-exp-rate.js 量出來的 rate(L) ＝ 該級實際經驗/小時
 *   ② 依設計意圖把總時數分配到每一級（段內用冪次 ramp，越後面越慢）
 *   ③ 該級所需經驗 ＝ rate(L) × hours(L)
 *   ④ 把結果擬合回 progression.js 的三段冪函數，印出新錨點
 *   ⑤ 用新曲線回推實際時數，驗證有沒有打中目標
 *
 * 用法：node scripts/tune-exp-curve.js
 */

const fs = require("fs");
const path = require("path");
const { MAX_LEVEL } = require("../src/shared/progression");

// ── 設計意圖：每段的目標時數（總和＝滿等時數）──
// 原始設計：每天 6 小時 × 5 天 ≈ 30 小時；1~10 簡單、11~35 也簡單、36~50 才是主耕作期。
// 2026-08-05 使用者決定整體 ×1.5 → 45 小時（每天 6 小時約 7.5 天），三段等比放大、比例不變。
const PACE_SCALE = 1.5;
const SEGMENTS = [
  { from: 1, to: 10, hours: 0.5 * PACE_SCALE, ramp: 1.0, label: "新手期" },
  { from: 11, to: 35, hours: 7.0 * PACE_SCALE, ramp: 1.6, label: "推進期" },
  { from: 36, to: 49, hours: 22.5 * PACE_SCALE, ramp: 1.8, label: "耕作期" },
];

// 校準：本腳本用「各區探測平均」估時數，端到端實跑可能有系統性偏差。
// 實測（node scripts/sim-level-run.js 1 3 12，12 種子平均）：本腳本估 26.0 h、實跑 25.3 h，
// 只差 3%，所以係數接近 1。
// ⚠️ 校準一定要用多種子平均——單一次跑的變異可達 ±20%（升級 +2 隨機屬性會改變 AGI→每場秒數），
//    拿單輪結果當校準基準會把曲線調歪。
const SIM_CALIBRATION = 30.0 / 29.2;

const rateFile = path.join(__dirname, "..", "docs", "balance-reports", "exp-rate-by-level.json");
if (!fs.existsSync(rateFile)) {
  console.error("缺少 exp-rate-by-level.json，請先跑：node scripts/measure-exp-rate.js 8 5 16");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(rateFile, "utf8"));
const rate = new Map(data.rows.map((r) => [r.level, r.expPerHour]));

// ②③④ 逐段求解 A·L^p，同時滿足兩個條件：
//   (a) 連續：本段起點值 ＝ 上一段終點值（不能有「升上去反而變快」的斷崖）
//   (b) 準確：本段 Σ(exp(L)/rate(L)) ＝ 該段目標時數
// A 由連續性定死（A = v_start / from^p），只剩 p 一個未知數 → 用二分法解。
const FIRST_LEVEL_EXP = 500;   // Lv1→2 起始值（唯一自由參數，跟現行 460 同量級）

function hoursOfSegment(seg, A, p) {
  let h = 0;
  for (let l = seg.from; l <= seg.to; l++) h += (A * Math.pow(l, p)) / (rate.get(l) || 1);
  return h;
}
function solveSegment(seg, vStart) {
  // p 越大 → 後段長越快 → 總時數越多，單調遞增，可二分
  let lo = 0.1, hi = 30;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const A = vStart / Math.pow(seg.from, mid);
    if (hoursOfSegment(seg, A, mid) < seg.hours * SIM_CALIBRATION) lo = mid; else hi = mid;
  }
  const p = (lo + hi) / 2;
  return { A: vStart / Math.pow(seg.from, p), p };
}

const fits = [];
let carry = FIRST_LEVEL_EXP;
for (const seg of SEGMENTS) {
  const fit = solveSegment(seg, carry);
  fits.push({ seg, fit });
  // 下一段的起點 ＝ 本段終點再往上一小階（保持單調遞增）
  carry = fit.A * Math.pow(seg.to, fit.p) * 1.05;
}

function newExpToNext(level) {
  for (const f of fits) if (level <= f.seg.to) return Math.round(f.fit.A * Math.pow(level, f.fit.p));
  const last = fits[fits.length - 1];
  return Math.round(last.fit.A * Math.pow(level, last.fit.p));
}

// ⑤ 驗證
console.log("═══ 新升等曲線 ═══");
console.log(`量測基準：同區 ${data.party} 人 ×${data.partyMult}　強化 +${data.enhance}\n`);
console.log("等級      該級所需經驗        經驗/小時      該級時數   累計時數");
console.log("─".repeat(66));
let cum = 0, total = 0;
const segActual = {};
for (let l = 1; l < MAX_LEVEL; l++) {
  const e = newExpToNext(l);
  const r = rate.get(l) || 1;
  const h = e / r;
  cum += h; total += e;
  for (const s of SEGMENTS) if (l >= s.from && l <= s.to) segActual[s.label] = (segActual[s.label] || 0) + h;
  if (l <= 12 || l % 3 === 0 || l >= 44) {
    console.log(`Lv${String(l).padStart(2)}→${String(l + 1).padEnd(3)} ${e.toLocaleString().padStart(14)} ${r.toLocaleString().padStart(14)} ${h.toFixed(2).padStart(9)} h ${cum.toFixed(1).padStart(8)} h`);
  }
}
console.log("─".repeat(66));
console.log(`Lv1→${MAX_LEVEL} 總經驗 ${total.toLocaleString()}　總時數 ${cum.toFixed(1)} h`);

console.log("\n【分段驗收】");
for (const s of SEGMENTS) {
  const a = segActual[s.label] || 0;
  const t = s.hours * SIM_CALIBRATION;
  console.log(`  Lv${s.from}→${s.to + 1} ${s.label}　目標 ${s.hours} h（校準後 ${t.toFixed(1)} h）　解出 ${a.toFixed(1)} h　${Math.abs(a - t) / t < 0.1 ? "✅" : "⚠️ 偏離"}`);
}
console.log(`\n總目標 ${SEGMENTS.reduce((a, b) => a + b.hours, 0).toFixed(1)} h　→ 每天 6 小時 ${(cum / SIM_CALIBRATION / 6).toFixed(1)} 天滿等（校準後的端到端預期）`);

console.log("\n【貼進 src/shared/progression.js 的錨點】");
for (const f of fits) {
  const lo = f.seg.from, hi = f.seg.to;
  console.log(`  // Lv${lo}~${hi}（${f.seg.label}，目標 ${f.seg.hours}h）`);
  console.log(`  const SEG = solvePower(${lo}, ${Math.round(f.fit.A * Math.pow(lo, f.fit.p))}, ${hi}, ${Math.round(f.fit.A * Math.pow(hi, f.fit.p))});`);
}

console.log("\n【新舊對照】");
const old = require("../src/shared/progression").expToNextLevel;
let oldTotal = 0, oldHours = 0;
for (let l = 1; l < MAX_LEVEL; l++) { oldTotal += old(l); oldHours += old(l) / (rate.get(l) || 1); }
console.log(`  舊：總經驗 ${oldTotal.toLocaleString()}　${oldHours.toFixed(1)} h（每天 6h → ${(oldHours / 6).toFixed(0)} 天）`);
console.log(`  新：總經驗 ${total.toLocaleString()}　${cum.toFixed(1)} h（每天 6h → ${(cum / 6).toFixed(1)} 天）`);
console.log(`  整體 ${(oldHours / cum).toFixed(1)} 倍快`);
