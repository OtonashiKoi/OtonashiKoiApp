"use strict";
/**
 * PK 跑分：抓所有 Lv.40 玩家配對 PK
 * 設 PK_ROUND_DAMAGE_CAP_PCT=999 可關掉 25% per-round HP cap
 *
 * 用法：
 *   node scripts/benchmark-pk-lv40.js                          # 預設（25% cap 開啟）
 *   PK_ROUND_DAMAGE_CAP_PCT=999 node scripts/benchmark-pk-lv40.js   # 無 cap
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runPkCombat } = require("../src/shared/pkCombat");

const RUNS_PER_PAIR = 10;        // 每對 PK 跑幾場
const MAX_PAIRS_PER_PLAYER = 5;  // 每位玩家最多跟幾個對手對打（避免 O(N²)）
const HP_MULT = Math.max(1, Number(process.env.PK_HP_MULTIPLIER) || 1); // PvP HP 倍率（測試用）

function pad(s, n) { s = String(s); return s + " ".repeat(Math.max(0, n - [...s].length)); }
function visW(s) { let w = 0; for (const c of String(s)) w += c.charCodeAt(0) > 127 ? 2 : 1; return w; }
function padV(s, n) { s = String(s); const w = visW(s); return s + " ".repeat(Math.max(0, n - w)); }

async function main() {
  const db = await getMongoDb();
  const progresses = await db.collection("progress")
    .find({ level: 40 })
    .toArray();

  const playerDocs = await db.collection("players")
    .find({ discordId: { $in: progresses.map(p => p.playerId) } })
    .project({ discordId: 1, displayName: 1, name: 1 })
    .toArray();
  const nameMap = new Map(playerDocs.map(p => [p.discordId, p.displayName || p.name || p.discordId.slice(-6)]));

  console.log(`\n${"═".repeat(110)}`);
  console.log(`PK 跑分：${progresses.length} 位 Lv.40 玩家，每對 ${RUNS_PER_PAIR} 場（最多 15 回合）`);
  console.log(`ROUND_DAMAGE_CAP_PCT = ${Number(process.env.PK_ROUND_DAMAGE_CAP_PCT) || 25}%${Number(process.env.PK_ROUND_DAMAGE_CAP_PCT) >= 999 ? "（無 cap）" : ""}｜HP 乘倍 = ×${HP_MULT}`);
  console.log("═".repeat(110));

  // 預先計算每位玩家的 stats + opts
  const players = progresses.map(p => {
    const attrs = p.attributes || {};
    const equipped = p.equipment || {};
    const inventory = p.inventory || [];
    const activeEffects = p.activeEffects || [];
    const baseStats = calcPlayerStats(attrs, equipped, activeEffects, inventory);
    // PvP HP 乘倍（測試用）
    const stats = HP_MULT === 1 ? baseStats : { ...baseStats, maxHp: Math.max(1, Math.round(baseStats.maxHp * HP_MULT)) };
    return {
      discordId: p.playerId,
      name: nameMap.get(p.playerId) || p.playerId.slice(-6),
      level: p.level,
      stats,
      opts: { equipped, inventory, activeEffects, level: p.level },
      attrs,
    };
  });

  // 配對：每位玩家隨機抽 N 個對手
  const pairings = [];
  const seen = new Set();
  for (const a of players) {
    const others = players.filter(p => p.discordId !== a.discordId);
    const shuffled = others.sort(() => Math.random() - 0.5).slice(0, MAX_PAIRS_PER_PLAYER);
    for (const b of shuffled) {
      const key = [a.discordId, b.discordId].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      pairings.push([a, b]);
    }
  }

  console.log(`配對總數：${pairings.length} 對\n`);
  console.log([padV("A 玩家", 14), padV("B 玩家", 14), pad("A→B 勝率", 10), pad("平均回合", 8),
               pad("A平均輸出", 10), pad("B平均輸出", 10), pad("A被淘汰%", 8), pad("結算"), ].join("  "));
  console.log("─".repeat(110));

  let allRounds = 0, allBattles = 0, allTimeouts = 0, allKills = 0;
  let allRound1Kills = 0, allRound2Kills = 0, allRound3Kills = 0;
  const perPlayerStats = new Map();

  for (const [a, b] of pairings) {
    let aWins = 0, bWins = 0, draws = 0;
    let totalRounds = 0, totalADmg = 0, totalBDmg = 0;
    let aDeaths = 0;
    let timeouts = 0;
    let pairRound1Kills = 0;

    for (let i = 0; i < RUNS_PER_PAIR; i++) {
      const aOpts = { ...a.opts, activeEffects: [...(a.opts.activeEffects || [])] };
      const bOpts = { ...b.opts, activeEffects: [...(b.opts.activeEffects || [])] };
      const r = runPkCombat(a.stats, aOpts, a.name, b.stats, bOpts, b.name, 15);

      const rounds = r.roundLogs?.length || 0;
      totalRounds += rounds;
      allRounds += rounds;
      allBattles++;
      if (r.winner === "A") { aWins++; allKills++; }
      else if (r.winner === "B") { bWins++; allKills++; aDeaths++; }
      else { draws++; allTimeouts++; timeouts++; }

      // 秒殺檢測
      if (r.winner !== null) {
        if (rounds === 1) { allRound1Kills++; pairRound1Kills++; }
        else if (rounds === 2) allRound2Kills++;
        else if (rounds === 3) allRound3Kills++;
      }

      // 累計傷害（正確欄位）
      const aDealt = Math.max(0, (b.stats.maxHp || 0) - (r.finalHpB ?? b.stats.maxHp));
      const bDealt = Math.max(0, (a.stats.maxHp || 0) - (r.finalHpA ?? a.stats.maxHp));
      totalADmg += aDealt;
      totalBDmg += bDealt;
    }

    const wr = ((aWins / RUNS_PER_PAIR) * 100).toFixed(0) + "%";
    const ar = (totalRounds / RUNS_PER_PAIR).toFixed(1);
    const aDpr = (totalADmg / RUNS_PER_PAIR).toFixed(0);
    const bDpr = (totalBDmg / RUNS_PER_PAIR).toFixed(0);
    const aDeathRate = ((aDeaths / RUNS_PER_PAIR) * 100).toFixed(0) + "%";
    const settled = `${aWins}勝/${draws}平/${bWins}敗`;

    // 累計每位玩家戰績
    function addStats(p, won, drew) {
      const s = perPlayerStats.get(p.discordId) || { name: p.name, level: p.level, wins: 0, draws: 0, losses: 0, total: 0 };
      if (won) s.wins++;
      else if (drew) s.draws++;
      else s.losses++;
      s.total++;
      perPlayerStats.set(p.discordId, s);
    }
    for (let i = 0; i < RUNS_PER_PAIR; i++) {
      // approximation: distribute by counts
    }
    const aStats = perPlayerStats.get(a.discordId) || { name: a.name, level: a.level, wins: 0, draws: 0, losses: 0, total: 0 };
    aStats.wins += aWins; aStats.draws += draws; aStats.losses += bWins; aStats.total += RUNS_PER_PAIR;
    perPlayerStats.set(a.discordId, aStats);
    const bStats = perPlayerStats.get(b.discordId) || { name: b.name, level: b.level, wins: 0, draws: 0, losses: 0, total: 0 };
    bStats.wins += bWins; bStats.draws += draws; bStats.losses += aWins; bStats.total += RUNS_PER_PAIR;
    perPlayerStats.set(b.discordId, bStats);

    console.log([
      padV(a.name.slice(0, 7), 14),
      padV(b.name.slice(0, 7), 14),
      pad(wr, 10),
      pad(ar, 8),
      pad(aDpr, 10),
      pad(bDpr, 10),
      pad(aDeathRate, 8),
      settled,
    ].join("  "));
  }

  // 整體統計
  console.log("\n" + "═".repeat(110));
  console.log("【全體統計】");
  console.log("═".repeat(110));
  console.log(`總場數：${allBattles}`);
  console.log(`平均回合：${(allRounds / allBattles).toFixed(2)}`);
  console.log(`Timeout 率（15 回合未分勝負）：${(allTimeouts / allBattles * 100).toFixed(1)}%（${allTimeouts} 場）`);
  console.log(`KO 率：${(allKills / allBattles * 100).toFixed(1)}%`);
  console.log("\n【秒殺分布】");
  console.log(`  第 1 回合 KO（純秒殺）：${(allRound1Kills / allBattles * 100).toFixed(1)}%（${allRound1Kills} 場）`);
  console.log(`  第 2 回合 KO：       ${(allRound2Kills / allBattles * 100).toFixed(1)}%（${allRound2Kills} 場）`);
  console.log(`  第 3 回合 KO：       ${(allRound3Kills / allBattles * 100).toFixed(1)}%（${allRound3Kills} 場）`);
  console.log(`  3 回合內 KO 累計：    ${((allRound1Kills + allRound2Kills + allRound3Kills) / allBattles * 100).toFixed(1)}%`);

  // 個人勝率排行（取前 15）
  console.log("\n" + "═".repeat(110));
  console.log("【個人勝率排行 Top 15】");
  console.log("═".repeat(110));
  const leaderboard = [...perPlayerStats.values()]
    .filter(s => s.total >= 10)
    .map(s => ({ ...s, winRate: s.wins / s.total }))
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 15);
  console.log([padV("玩家", 16), pad("勝率", 7), pad("勝", 4), pad("平", 4), pad("敗", 4), pad("場數", 5)].join("  "));
  console.log("─".repeat(60));
  for (const s of leaderboard) {
    console.log([
      padV(s.name.slice(0, 8), 16),
      pad((s.winRate * 100).toFixed(0) + "%", 7),
      pad(s.wins, 4),
      pad(s.draws, 4),
      pad(s.losses, 4),
      pad(s.total, 5),
    ].join("  "));
  }
  // 倒數
  console.log("\n【勝率墊底 5 位】");
  const bottom = [...perPlayerStats.values()]
    .filter(s => s.total >= 10)
    .map(s => ({ ...s, winRate: s.wins / s.total }))
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 5);
  for (const s of bottom) {
    console.log([
      padV(s.name.slice(0, 8), 16),
      pad((s.winRate * 100).toFixed(0) + "%", 7),
      pad(s.wins, 4),
      pad(s.draws, 4),
      pad(s.losses, 4),
      pad(s.total, 5),
    ].join("  "));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
