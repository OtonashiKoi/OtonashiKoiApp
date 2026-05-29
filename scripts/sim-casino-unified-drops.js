// 統一掉落池模擬：押中色 = 抽一次大池，與押哪色無關
"use strict";
const crypto = require("crypto");

const WHEEL = [
  ...Array(9).fill({ color: "yellow", mult: 2 }),
  ...Array(6).fill({ color: "green",  mult: 3 }),
  ...Array(3).fill({ color: "red",    mult: 5 }),
  ...Array(1).fill({ color: "blue",   mult: 10 }),
  ...Array(1).fill({ color: "purple", mult: 15 }),
];

// 下注額 → 抽中總機率 + 解鎖階級
function getBetTier(amount) {
  if (amount >= 10000) return { rate: 0.20, tier: 3 }; // 解鎖到 A
  if (amount >= 5000)  return { rate: 0.15, tier: 2 }; // 解鎖到 B
  if (amount >= 1000)  return { rate: 0.12, tier: 1 }; // 解鎖到 C
  if (amount >= 100)   return { rate: 0.08, tier: 0 }; // 只能 D
  return { rate: 0,    tier: -1 };
}

// 道具池：minTier 表示需達到的下注階級
const POOL = [
  { key: "stone_D", label: "D 階強化石",         weight: 400, minTier: 0 },
  { key: "stone_C", label: "C 階強化石",         weight: 200, minTier: 1 },
  { key: "stone_B", label: "B 階強化石",         weight: 60,  minTier: 2 },
  { key: "stone_A", label: "A 階強化石",         weight: 15,  minTier: 3 },
  { key: "equip_D", label: "D 階裝備",           weight: 200, minTier: 0 },
  { key: "equip_C", label: "C 階裝備",           weight: 100, minTier: 1 },
  { key: "equip_B", label: "B 階裝備",           weight: 30,  minTier: 2 },
  { key: "equip_A", label: "A 階裝備",           weight: 5,   minTier: 3 },
  { key: "card_D",  label: "D 階卡片",           weight: 80,  minTier: 0 },
  { key: "card_C",  label: "C 階卡片",           weight: 30,  minTier: 1 },
  { key: "card_B",  label: "B 階卡片",           weight: 10,  minTier: 2 },
  { key: "card_A",  label: "A 階卡片(非Boss)",    weight: 2,   minTier: 3 },
];

function spin() {
  return WHEEL[crypto.randomInt(0, WHEEL.length)];
}

function rollDrop(amount) {
  const { rate, tier } = getBetTier(amount);
  if (tier < 0) return null;
  if (crypto.randomInt(0, 1_000_000) / 1_000_000 >= rate) return null;
  const eligible = POOL.filter((p) => p.minTier <= tier);
  const total = eligible.reduce((a, b) => a + b.weight, 0);
  let r = crypto.randomInt(0, total);
  for (const p of eligible) { r -= p.weight; if (r < 0) return p; }
  return eligible[eligible.length - 1];
}

// ─── 一、池內機率（解鎖到 A 時）─────────────────────
console.log("\n═══ 一、押 ≥10000（全解鎖）池內各物機率 ═══");
{
  const total = POOL.reduce((a, b) => a + b.weight, 0);
  for (const p of POOL) {
    const inPool = (p.weight / total * 100).toFixed(3);
    const global = (0.20 * p.weight / total * 100).toFixed(4); // 抽中後
    console.log(`  ${p.label.padEnd(18)} 權重 ${String(p.weight).padStart(4)}  池內 ${inPool.padStart(6)}%  押中後全局 ${global.padStart(6)}%`);
  }
}

// ─── 二、各下注額情境模擬 ─────────────────────────────
const SCENARIOS = [
  { name: "押 100 黃",     bet: 100,   color: "yellow" },
  { name: "押 1000 黃",    bet: 1000,  color: "yellow" },
  { name: "押 5000 黃",    bet: 5000,  color: "yellow" },
  { name: "押 10000 黃",   bet: 10000, color: "yellow" },
  { name: "押 10000 綠",   bet: 10000, color: "green" },
  { name: "押 10000 紅",   bet: 10000, color: "red" },
  { name: "押 10000 藍",   bet: 10000, color: "blue" },
  { name: "押 10000 紫",   bet: 10000, color: "purple" },
  { name: "押 50000 黃",   bet: 50000, color: "yellow" },
];

const ROUNDS = 100_000;
const SECONDS_PER_ROUND = 60;
console.log(`\n═══ 二、${ROUNDS} 輪模擬（${(ROUNDS * SECONDS_PER_ROUND / 86400).toFixed(1)} 天）═══\n`);

function fmtInterval(rounds) {
  const sec = rounds * SECONDS_PER_ROUND;
  if (sec < 3600) return `${(sec / 60).toFixed(1)} 分`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 時`;
  return `${(sec / 86400).toFixed(2)} 天`;
}

for (const sc of SCENARIOS) {
  let totalBet = 0, totalPay = 0, hits = 0;
  const drops = {};
  for (let i = 0; i < ROUNDS; i++) {
    const r = spin();
    totalBet += sc.bet;
    if (r.color === sc.color) {
      hits++;
      totalPay += sc.bet * r.mult;
      const d = rollDrop(sc.bet);
      if (d) drops[d.key] = (drops[d.key] || 0) + 1;
    }
  }
  const net = totalPay - totalBet;
  const roi = (net / totalBet * 100).toFixed(2);
  console.log(`▼ ${sc.name}`);
  console.log(`   下注 ${totalBet.toLocaleString().padStart(13)}  贏回 ${totalPay.toLocaleString().padStart(13)}  ROI ${roi}%  押中 ${hits} 次`);
  const sortedDrops = POOL.filter((p) => drops[p.key]);
  if (sortedDrops.length) {
    const lines = sortedDrops.map((p) => `${p.label}=${drops[p.key]} (每 ${fmtInterval(ROUNDS / drops[p.key])})`);
    console.log("   掉落：" + lines.join("、"));
  } else {
    console.log("   掉落：無");
  }
  console.log("");
}

// ─── 三、全局期望（多玩家平均場景）─────────────────
console.log("═══ 三、全伺服器期望（假設每輪平均下注 5000 在各色，押中即抽）═══\n");
{
  // 模擬：每輪 5 個玩家，每人押 5000 在隨機一色
  let totalBet = 0, totalPay = 0;
  const drops = {};
  for (let i = 0; i < ROUNDS; i++) {
    const r = spin();
    for (let p = 0; p < 5; p++) {
      const colorIdx = crypto.randomInt(0, 5);
      const color = ["yellow", "green", "red", "blue", "purple"][colorIdx];
      const amount = 5000 + crypto.randomInt(0, 5001); // 5000–10000 隨機
      totalBet += amount;
      if (r.color === color) {
        totalPay += amount * r.mult;
        const d = rollDrop(amount);
        if (d) drops[d.key] = (drops[d.key] || 0) + 1;
      }
    }
  }
  console.log(`  總下注 ${totalBet.toLocaleString()}  總贏回 ${totalPay.toLocaleString()}  ROI ${((totalPay - totalBet) / totalBet * 100).toFixed(2)}%`);
  console.log(`  掉落速率：`);
  for (const p of POOL) {
    const n = drops[p.key] || 0;
    const interval = n > 0 ? fmtInterval(ROUNDS / n) : "∞";
    console.log(`    ${p.label.padEnd(18)} ${String(n).padStart(5)} 次  平均每 ${interval} 1 件`);
  }
}

// ─── 四、紫色 + 押滿的「夢中夢」場景 ─────────────────
console.log("\n═══ 四、紫色玩家視角：押 10000 紫（最樂透）═══");
{
  let totalBet = 0, totalPay = 0, hits = 0;
  const drops = {};
  for (let i = 0; i < ROUNDS; i++) {
    totalBet += 10000;
    const r = spin();
    if (r.color === "purple") {
      hits++;
      totalPay += 10000 * 15;
      const d = rollDrop(10000);
      if (d) drops[d.key] = (drops[d.key] || 0) + 1;
    }
  }
  console.log(`  ROI ${((totalPay - totalBet) / totalBet * 100).toFixed(2)}%  押中紫 ${hits} 次（每 ${(ROUNDS / hits).toFixed(0)} 輪）`);
  for (const p of POOL) {
    if (!drops[p.key]) continue;
    console.log(`    ${p.label}: ${drops[p.key]} 次（每 ${fmtInterval(ROUNDS / drops[p.key])}）`);
  }
}

console.log("");
