#!/usr/bin/env node
"use strict";
// 分析：目前玩家戰力，前段班能否 solo 大史王(多進場)。輸出戰力規劃表。
// 用真實 calcPlayerStats + runCombatLoop 模擬(每位打 N 場取平均，含爆擊變異)。
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const mz = require("../src/bot/handlers/monsterZoneHandlers");
const { statBonusOf } = require("../src/shared/petDex");

const ZONE = "elite";
const SOLO_HP = 450000;             // 單人大史王(soloBossRoutes)
const GROUP_HP = 1770000;           // 團體大史王(elite zone)
const BOSS_TOTAL_HP = SOLO_HP;      // 規劃表以單人王為主
const ENTRY_FEE = 5000;
const MAX_ROUNDS = 15;
const SIMS = 5;                     // 每位模擬場數取平均(降低爆擊變異)
const TOP_N = 18;

function prettyName(dn, id) {
  const s = String(dn || "").trim();
  if (!s || s === String(id) || /^\d{15,}$/.test(s)) return id ? `玩家#${String(id).slice(-4)}` : "玩家";
  return s;
}

(async () => {
  const repos = createMongoRepositories();
  const db = await getMongoDb();
  const players = await db.collection("players").find({}).toArray();
  const boss = await db.collection("monsters").findOne({ $or: [{ zone: ZONE }, { zoneKey: ZONE }], isBoss: true });
  const bossCalc = boss.calc || boss;
  const monsterEquipped = (typeof mz.buildMonsterEquipped === "function") ? mz.buildMonsterEquipped(boss) : {};

  // 一場模擬：玩家 vs 大史王(以超大 HP 跑滿 15 回合，量測每場輸出)
  function simOneFight(pStats) {
    // 世界王攻擊面部位調整(取軀幹,佔血最大)；玩家面調整
    const part = "body";
    let bp = pStats, bm = bossCalc, bmEq = monsterEquipped;
    try { bp = mz.applyWorldBossTargetToPlayerStats(pStats, part, ZONE).stats || pStats; } catch (_) {}
    try { const a = mz.applyWorldBossTargetToMonster(bossCalc, monsterEquipped, part, ZONE); bm = a.monsterStats || bossCalc; bmEq = a.monsterEquipped || monsterEquipped; } catch (_) {}
    const r = runCombatLoop(bp, bm, boss.name, 99999999, MAX_ROUNDS, {
      monsterEquipped: bmEq, monsterIsBoss: true, isWorldBoss: true, zone: ZONE
    });
    return { dmg: Math.max(0, Number(r.totalDamage) || 0), taken: Math.max(0, (pStats.maxHp || 0) - (Number(r.finalPlayerHp) || 0)), died: r.outcome === "lose" };
  }

  const rows = [];
  for (const p of players) {
    if (p.status === "disabled") continue;
    const id = p.discordId;
    let progress;
    try { progress = await repos.progressRepository.findByPlayerId(id); } catch (_) { continue; }
    if (!progress) continue;
    const level = progress.level || 1;
    if (level < 20) continue; // 低等略過(非前段班)
    const attrs = progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    let pStats;
    try {
      pStats = calcPlayerStats(attrs, progress.equipment || {}, progress.activeEffects || [], progress.inventory || [], { pkRating: progress.pkRating, zone: ZONE, petStat: statBonusOf(progress.petDex) });
    } catch (_) { continue; }
    // 多場平均
    let sum = 0, maxTaken = 0, deaths = 0;
    for (let i = 0; i < SIMS; i++) { const s = simOneFight(pStats); sum += s.dmg; maxTaken = Math.max(maxTaken, s.taken); if (s.died) deaths++; }
    const avgDmg = Math.round(sum / SIMS);
    if (avgDmg <= 0) continue;
    const fights = Math.ceil(SOLO_HP / avgDmg);
    const groupFights = Math.ceil(GROUP_HP / avgDmg);
    const job = progress.equipment?.job_eq?.itemName || progress.equipment?.job_eq?.name || "-";
    rows.push({
      name: prettyName(p.displayName, id), level, job,
      atk: Math.round(pStats.atk || 0), hp: Math.round(pStats.maxHp || 0),
      wpn: pStats.weaponType || "-",
      avgDmg, fights, groupFights, goldCost: fights * ENTRY_FEE, maxTaken, deaths,
      survive: maxTaken < (pStats.maxHp || 1)
    });
  }

  rows.sort((a, b) => b.avgDmg - a.avgDmg);
  const top = rows.slice(0, TOP_N);
  console.log(`\n=== 大史王 戰力規劃表 (單人王 ${SOLO_HP.toLocaleString()} / 團體王 ${GROUP_HP.toLocaleString()}, 入場費 ${ENTRY_FEE}, 每場 ${MAX_ROUNDS} 回合) ===`);
  console.log(`共 ${rows.length} 位 Lv20+ 有輸出玩家，前 ${top.length} 名(依每場傷害):\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const padS = (s, n) => String(s).padStart(n);
  console.log(pad("#", 3) + pad("玩家", 15) + padS("Lv", 3) + " " + pad("職業", 10) + padS("每場傷害", 9) + padS("單人場數", 9) + padS("單人費", 9) + padS("團體場數", 9) + " 存活");
  top.forEach((r, i) => {
    console.log(pad(i + 1, 3) + pad(r.name, 15) + padS(r.level, 3) + " " + pad(r.job, 10) + padS(r.avgDmg.toLocaleString(), 9) + padS(r.fights + "場", 9) + padS(r.goldCost.toLocaleString(), 9) + padS(r.groupFights + "場", 9) + " " + (r.survive ? "✅" : "⚠️"));
  });
  const b = (lo, hi) => rows.filter(r => r.fights > lo && r.fights <= hi).length;
  console.log(`\n單人王分層(需場數)：≤5場 ${rows.filter(r => r.fights <= 5).length} 位 | 6~10場 ${b(5, 10)} 位 | 11~20場 ${b(10, 20)} 位 | 21~40場 ${b(20, 40)} 位 | >40場 ${rows.filter(r => r.fights > 40).length} 位`);
  console.log(`(每日單人王最多擊殺 3 隻＝領 3 次獎；不限場次累積磨)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
