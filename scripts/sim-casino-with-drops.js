// 賭場轉盤 + 道具掉落 完整模擬
"use strict";
const crypto = require("crypto");

const WHEEL = [
  ...Array(9).fill({ color: "yellow", mult: 2 }),
  ...Array(6).fill({ color: "green",  mult: 3 }),
  ...Array(3).fill({ color: "red",    mult: 5 }),
  ...Array(1).fill({ color: "blue",   mult: 10 }),
  ...Array(1).fill({ color: "purple", mult: 15 }),
];

// 顏色 → { 抽中道具總機率, 道具池 [{tier, weight, minBetTier}] }
// minBetTier：1=>=1000, 2=>=5000, 3=>=10000
const DROP_TABLE = {
  yellow: { rate: 0.05, pool: [
    { kind: "equip", tier: "D", weight: 70, minBetTier: 1 },
    { kind: "equip", tier: "C", weight: 30, minBetTier: 1 },
  ]},
  green: { rate: 0.04, pool: [
    { kind: "equip", tier: "D", weight: 40, minBetTier: 1 },
    { kind: "equip", tier: "C", weight: 50, minBetTier: 1 },
    { kind: "equip", tier: "B", weight: 10, minBetTier: 2 },
  ]},
  red: { rate: 0.03, pool: [
    { kind: "equip", tier: "C", weight: 40, minBetTier: 1 },
    { kind: "equip", tier: "B", weight: 50, minBetTier: 2 },
    { kind: "card",  tier: "normal", weight: 10, minBetTier: 2 },
  ]},
  blue: { rate: 0.025, pool: [
    { kind: "equip", tier: "B", weight: 50, minBetTier: 2 },
    { kind: "equip", tier: "A", weight: 40, minBetTier: 3 },
    { kind: "card",  tier: "strong", weight: 10, minBetTier: 3 },
  ]},
  purple: { rate: 0.03, pool: [
    { kind: "equip", tier: "A", weight: 80, minBetTier: 3 },
    { kind: "card",  tier: "A_non_boss", weight: 20, minBetTier: 3 },
  ]},
};

function betTier(amount) {
  if (amount >= 10000) return 3;
  if (amount >= 5000) return 2;
  if (amount >= 1000) return 1;
  return 0;
}

function spin() {
  return WHEEL[crypto.randomInt(0, WHEEL.length)];
}

function rollDrop(color, betAmount) {
  const tbl = DROP_TABLE[color];
  if (!tbl) return null;
  // 先擲總機率
  if (crypto.randomInt(0, 1_000_000) / 1_000_000 >= tbl.rate) return null;
  // 過濾下注門檻
  const tier = betTier(betAmount);
  const eligible = tbl.pool.filter((p) => p.minBetTier <= tier);
  if (!eligible.length) return null;
  // 加權抽取
  const total = eligible.reduce((a, b) => a + b.weight, 0);
  let r = crypto.randomInt(0, total);
  for (const p of eligible) { r -= p.weight; if (r < 0) return p; }
  return eligible[eligible.length - 1];
}

// ─── 情境模擬 ───
const SCENARIOS = [
  { name: "微氪：每輪押 100 黃",        bet: 100,   color: "yellow" },
  { name: "小資：每輪押 1000 黃",       bet: 1000,  color: "yellow" },
  { name: "中資：每輪押 5000 黃",       bet: 5000,  color: "yellow" },
  { name: "重氪：每輪押 10000 黃",      bet: 10000, color: "yellow" },
  { name: "重氪+樂透：押 10000 紫",     bet: 10000, color: "purple" },
  { name: "重氪+保險：押 9000黃+1000紫", bet: [{c:"yellow",a:9000},{c:"purple",a:1000}] },
  { name: "夢想家：押 10000 藍",        bet: 10000, color: "blue" },
];

const ROUNDS = 100_000;  // 模擬 10 萬輪 ≈ 70 天連續開盤
console.log(`\n═══ ${ROUNDS} 輪模擬（${(ROUNDS * 60 / 86400).toFixed(1)} 天 24h 連續開盤）═══\n`);

for (const sc of SCENARIOS) {
  let totalBet = 0, totalPay = 0;
  const drops = { D: 0, C: 0, B: 0, A_equip: 0, A_card: 0, strong_card: 0, normal_card: 0 };
  for (let i = 0; i < ROUNDS; i++) {
    const r = spin();
    const bets = Array.isArray(sc.bet)
      ? sc.bet.map((x) => ({ color: x.c, amount: x.a }))
      : [{ color: sc.color, amount: sc.bet }];

    for (const b of bets) {
      totalBet += b.amount;
      if (b.color === r.color) {
        totalPay += b.amount * r.mult;
        const drop = rollDrop(r.color, b.amount);
        if (drop) {
          if (drop.kind === "equip" && drop.tier === "A") drops.A_equip++;
          else if (drop.kind === "equip") drops[drop.tier]++;
          else if (drop.kind === "card" && drop.tier === "A_non_boss") drops.A_card++;
          else if (drop.kind === "card" && drop.tier === "strong") drops.strong_card++;
          else if (drop.kind === "card") drops.normal_card++;
        }
      }
    }
  }
  const net = totalPay - totalBet;
  const roi = (net / totalBet * 100).toFixed(2);
  console.log(`▼ ${sc.name}`);
  console.log(`  下注 ${totalBet.toLocaleString()}  贏回 ${totalPay.toLocaleString()}  淨 ${net.toLocaleString()}  ROI ${roi}%`);
  console.log(`  道具掉落：D=${drops.D} C=${drops.C} B=${drops.B} A裝=${drops.A_equip} A卡=${drops.A_card} 強卡=${drops.strong_card} 普通卡=${drops.normal_card}`);
  const daysPerA = drops.A_equip > 0 ? ((ROUNDS / drops.A_equip) * 60 / 86400).toFixed(2) : "∞";
  const daysPerACard = drops.A_card > 0 ? ((ROUNDS / drops.A_card) * 60 / 86400).toFixed(2) : "∞";
  console.log(`  平均每 ${daysPerA} 天出一件 A 裝、每 ${daysPerACard} 天出一張 A 卡`);
  console.log("");
}

// ─── 全局掉落速率（不分情境，假設所有玩家都押滿門檻 10000 平均押在各色）───
console.log(`═══ 全局期望（假設所有押注都 ≥10000 平鋪 5 色，每輪 50000 下注）═══`);
{
  let drops = { D: 0, C: 0, B: 0, A_equip: 0, A_card: 0, strong_card: 0, normal_card: 0 };
  for (let i = 0; i < ROUNDS; i++) {
    const r = spin();
    const colors = ["yellow", "green", "red", "blue", "purple"];
    for (const c of colors) {
      if (c === r.color) {
        const drop = rollDrop(r.color, 10000);
        if (!drop) continue;
        if (drop.kind === "equip" && drop.tier === "A") drops.A_equip++;
        else if (drop.kind === "equip") drops[drop.tier]++;
        else if (drop.kind === "card" && drop.tier === "A_non_boss") drops.A_card++;
        else if (drop.kind === "card" && drop.tier === "strong") drops.strong_card++;
        else if (drop.kind === "card") drops.normal_card++;
      }
    }
  }
  for (const [k, v] of Object.entries(drops)) {
    const perRound = v / ROUNDS;
    const interval = v > 0 ? (1 / perRound).toFixed(0) : "∞";
    const hours = v > 0 ? (interval * 60 / 3600).toFixed(2) : "∞";
    console.log(`  ${k.padEnd(12)} 共 ${v} 次，平均每 ${interval} 輪 (${hours} 小時) 1 次`);
  }
}
console.log("");
