"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const ZONES = ["beginner", "normal", "mid", "hard", "elite"];

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  
  const monstersCol = db.collection("monsters");
  
  console.log("📊 各區怪物金幣經濟效益分析\n");
  console.log("=" .repeat(100));
  
  const zoneData = {};
  
  for (const zone of ZONES) {
    const monsters = await monstersCol.find({ zone, enabled: true }).toArray();
    
    if (monsters.length === 0) {
      console.log(`\n⚠️  ${zone}: 沒有啟用的怪物`);
      continue;
    }

    // 計算統計數據
    const stats = {
      count: monsters.length,
      entryFees: monsters.map(m => m.entryFee || 0),
      goldRewards: monsters.map(m => m.goldReward || 0),
    };

    stats.avgEntryFee = Math.round(stats.entryFees.reduce((a, b) => a + b, 0) / stats.count);
    stats.avgGoldReward = Math.round(stats.goldRewards.reduce((a, b) => a + b, 0) / stats.count);
    stats.netProfit = stats.avgGoldReward - stats.avgEntryFee;
    stats.roi = stats.avgEntryFee > 0 ? ((stats.netProfit / stats.avgEntryFee) * 100).toFixed(1) : 0;
    stats.minEntry = Math.min(...stats.entryFees);
    stats.maxEntry = Math.max(...stats.entryFees);
    stats.minReward = Math.min(...stats.goldRewards);
    stats.maxReward = Math.max(...stats.goldRewards);

    zoneData[zone] = stats;

    console.log(`\n🌍 ${zone.toUpperCase()}`);
    console.log(`├─ 怪物數量: ${stats.count}`);
    console.log(`├─ 入場費: ${stats.minEntry}~${stats.maxEntry} (平均 ${stats.avgEntryFee})`);
    console.log(`├─ 金幣獎勵: ${stats.minReward}~${stats.maxReward} (平均 ${stats.avgGoldReward})`);
    console.log(`├─ 單次淨利: ${stats.netProfit} (${stats.roi}% ROI)`);
    console.log(`└─ 100次戰鬥: 消耗 ${stats.avgEntryFee * 100} 🪙, 獲得 ${stats.avgGoldReward * 100} 🪙, 淨利 ${stats.netProfit * 100} 🪙`);
  }

  console.log("\n" + "=".repeat(100));
  console.log("\n💡 經濟效益排行\n");

  // 按ROI排序
  const sorted = Object.entries(zoneData)
    .map(([zone, stats]) => ({ zone, ...stats }))
    .sort((a, b) => parseFloat(b.roi) - parseFloat(a.roi));

  sorted.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.zone.toUpperCase().padEnd(10)} - ROI: ${item.roi}% (淨利/場: ${item.netProfit})`);
  });

  console.log("\n" + "=".repeat(100));
  console.log("\n📈 相對比例分析（以新手區為基準）\n");

  const beginner = zoneData["beginner"];
  if (beginner) {
    console.log(`基準區 (BEGINNER): 淨利 ${beginner.netProfit}/場\n`);
    
    for (const zone of ZONES) {
      if (zone === "beginner") continue;
      const zoneStats = zoneData[zone];
      if (!zoneStats) continue;
      
      const ratio = (zoneStats.netProfit / beginner.netProfit).toFixed(2);
      const profitDiff = zoneStats.netProfit - beginner.netProfit;
      console.log(`${zone.toUpperCase().padEnd(10)} - 淨利 ${zoneStats.netProfit}/場 (${ratio}倍, +${profitDiff})`);
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("\n⏱️  時間效益假設（假設每區怪物打敗時間相同）\n");

  const baseProfitPerTime = beginner.netProfit;
  console.log(`若假設每場戰鬥用時相同，單位時間金幣效率排行：\n`);

  sorted.forEach((item, idx) => {
    const timeEfficiency = item.netProfit;
    const bonus = item.netProfit - beginner.netProfit;
    console.log(`${idx + 1}. ${item.zone.toUpperCase().padEnd(10)} - ${timeEfficiency.toString().padEnd(6)} 金幣/場 (相比新手區 ${bonus > 0 ? '+' : ''}${bonus})`);
  });

  await client.close();
  console.log("\n✨ 分析完成");
}

main().catch((error) => {
  console.error("[error] analysis failed:", error);
  process.exitCode = 1;
});
