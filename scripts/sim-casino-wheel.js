// 賭場轉盤平衡模擬
// 20 格、5 色：黃×2(9格) / 綠×3(6格) / 紅×5(3格) / 藍×10(1格) / 紫×20(1格)
"use strict";
const crypto = require("crypto");

const WHEEL = [
  ...Array(9).fill({ color: "yellow", mult: 2 }),
  ...Array(6).fill({ color: "green",  mult: 3 }),
  ...Array(3).fill({ color: "red",    mult: 5 }),
  ...Array(1).fill({ color: "blue",   mult: 10 }),
  ...Array(1).fill({ color: "purple", mult: 20 }),
];
const SLOTS = WHEEL.length;

function spin() {
  return WHEEL[crypto.randomInt(0, SLOTS)];
}

// 玩家策略 ─────────────────────────────────────
const STRATEGIES = {
  "純押黃 (×2 安全派)":        () => [{ color: "yellow", amount: 100 }],
  "純押綠 (×3 中庸派)":        () => [{ color: "green",  amount: 100 }],
  "純押紅 (×5 賭徒)":          () => [{ color: "red",    amount: 100 }],
  "純押藍 (×10 高賠)":         () => [{ color: "blue",   amount: 100 }],
  "純押紫 (×20 樂透)":         () => [{ color: "purple", amount: 100 }],
  "黃+紫保險 (90+10)":         () => [{ color: "yellow", amount: 90 }, { color: "purple", amount: 10 }],
  "全色平鋪 (各20)":           () => [
    { color: "yellow", amount: 20 }, { color: "green", amount: 20 },
    { color: "red", amount: 20 }, { color: "blue", amount: 20 }, { color: "purple", amount: 20 },
  ],
  "黃綠分散 (50+50)":          () => [{ color: "yellow", amount: 50 }, { color: "green", amount: 50 }],
  "馬丁格爾 (押黃倍翻)":       null, // 特殊：狀態化
};

const ROUNDS = 100_000;
const BET_CAP = 50_000;     // 單筆上限
const PAYOUT_CAP = 500_000; // 單輪賠付上限

// 1) 純機率驗證
console.log("\n═══ 一、轉盤幾何 ═══");
const colorCounts = {};
for (const w of WHEEL) colorCounts[w.color] = (colorCounts[w.color] || 0) + 1;
console.log(`總格數 ${SLOTS}`);
for (const [c, n] of Object.entries(colorCounts)) {
  const p = n / SLOTS;
  const mult = WHEEL.find((w) => w.color === c).mult;
  const ev = mult * p;
  console.log(`  ${c.padEnd(7)} ×${mult.toString().padStart(2)}  ${n}格  機率 ${(p * 100).toFixed(2).padStart(5)}%  EV=${ev.toFixed(3)}  房屋抽水=${((1 - ev) * 100).toFixed(2)}%`);
}

// 2) 開獎分布驗證（10萬輪）
console.log("\n═══ 二、10 萬輪開獎分布 ═══");
const empirical = {};
for (let i = 0; i < ROUNDS; i++) {
  const r = spin();
  empirical[r.color] = (empirical[r.color] || 0) + 1;
}
for (const [c, n] of Object.entries(empirical)) {
  const expected = (colorCounts[c] / SLOTS) * ROUNDS;
  const diff = ((n - expected) / expected * 100).toFixed(2);
  console.log(`  ${c.padEnd(7)} 實際 ${String(n).padStart(6)}  理論 ${String(expected).padStart(6)}  偏差 ${diff}%`);
}

// 3) 各策略 10 萬輪實戰
console.log("\n═══ 三、各策略 10 萬輪實戰（初始本金 100 金幣/輪）═══");
console.log("策略".padEnd(28) + "下注總額".padStart(12) + "贏回總額".padStart(12) + "淨收益".padStart(12) + "ROI".padStart(10) + "最大連敗".padStart(10));
console.log("─".repeat(84));

for (const [name, fn] of Object.entries(STRATEGIES)) {
  if (!fn) continue;
  let totalBet = 0, totalPay = 0, maxLoseStreak = 0, curLose = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const bets = fn();
    const r = spin();
    let bet = 0, pay = 0;
    for (const b of bets) {
      bet += b.amount;
      if (b.color === r.color) pay += Math.min(b.amount * r.mult, PAYOUT_CAP);
    }
    totalBet += bet; totalPay += pay;
    if (pay > 0) { curLose = 0; } else { curLose++; if (curLose > maxLoseStreak) maxLoseStreak = curLose; }
  }
  const net = totalPay - totalBet;
  const roi = (net / totalBet * 100).toFixed(2);
  console.log(
    name.padEnd(28) +
    String(totalBet).padStart(12) +
    String(totalPay).padStart(12) +
    String(net).padStart(12) +
    `${roi}%`.padStart(10) +
    String(maxLoseStreak).padStart(10),
  );
}

// 4) 馬丁格爾單獨跑（押黃，輸了 ×2，受 BET_CAP 限制）
console.log("\n═══ 四、馬丁格爾（押黃 ×2，輸了倍翻，碰到上限歸位）═══");
{
  let bankroll = 10_000;        // 初始本金
  const baseBet = 100;
  let bet = baseBet;
  let totalBet = 0, totalPay = 0, busted = 0;
  let lowest = bankroll, highest = bankroll;
  for (let i = 0; i < ROUNDS; i++) {
    if (bankroll < bet) { busted++; bet = baseBet; bankroll += 10_000; continue; } // 補血再戰
    const useBet = Math.min(bet, BET_CAP, bankroll);
    totalBet += useBet;
    bankroll -= useBet;
    const r = spin();
    if (r.color === "yellow") {
      const pay = Math.min(useBet * 2, PAYOUT_CAP);
      totalPay += pay; bankroll += pay;
      bet = baseBet;
    } else {
      bet = Math.min(bet * 2, BET_CAP);
    }
    if (bankroll < lowest) lowest = bankroll;
    if (bankroll > highest) highest = bankroll;
  }
  console.log(`  下注總額 ${totalBet}`);
  console.log(`  贏回總額 ${totalPay}`);
  console.log(`  淨收益   ${totalPay - totalBet}  (ROI ${((totalPay - totalBet) / totalBet * 100).toFixed(2)}%)`);
  console.log(`  破產補血次數 ${busted}`);
  console.log(`  本金谷底 ${lowest} / 高點 ${highest}`);
}

// 5) 莊家視角：百萬輪總抽水率
console.log("\n═══ 五、莊家視角：百萬玩家×平鋪下注 ═══");
{
  const MIL = 1_000_000;
  let bet = 0, pay = 0;
  for (let i = 0; i < MIL; i++) {
    const r = spin();
    const each = 20;
    bet += each * 5;
    if (r.color === "yellow") pay += each * 2;
    if (r.color === "green")  pay += each * 3;
    if (r.color === "red")    pay += each * 5;
    if (r.color === "blue")   pay += each * 10;
    if (r.color === "purple") pay += each * 20;
  }
  console.log(`  總下注 ${bet}`);
  console.log(`  總賠付 ${pay}`);
  console.log(`  莊家抽水 ${bet - pay}  (${((1 - pay / bet) * 100).toFixed(2)}%)`);
}

// 6) 紫色保底大獎觸發頻率
console.log("\n═══ 六、紫格 ×20 觸發頻率 ═══");
{
  let intervals = [];
  let lastPurple = 0;
  let count = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    const r = spin();
    if (r.color === "purple") {
      intervals.push(i - lastPurple);
      lastPurple = i;
      count++;
    }
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const maxInterval = Math.max(...intervals);
  const minInterval = Math.min(...intervals);
  console.log(`  10 萬輪中紫格觸發 ${count} 次`);
  console.log(`  平均間隔 ${avgInterval.toFixed(1)} 輪（理論 20）`);
  console.log(`  最長乾旱 ${maxInterval} 輪、最短 ${minInterval} 輪`);
  console.log(`  以 60 秒/輪計：平均每 ${(avgInterval * 60 / 60).toFixed(1)} 分鐘出一次紫，最長 ${(maxInterval * 60 / 60).toFixed(0)} 分鐘沒紫`);
}

console.log("");
