"use strict";
/**
 * 跑分測試：拉 MongoDB 裡所有 Lv.2+ 的玩家，
 * 用他們身上的實際裝備、屬性，去打他們等級對應的區域怪物。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS_PER_MONSTER = 20;
const MAX_ROUNDS = 15;

// 等級 → 對應區域（取該等級能進入、且目前 DB 內有怪物的最高代表區）
// 目前 DB 內僅 beginner / normal / mid / ancient_city / ancient_city_deep / elite(Lv.60) 有怪
function pickZoneForLevel(level) {
  if (level <= 3)  return "beginner";
  if (level < 10)  return "normal";
  if (level < 20)  return "mid";
  if (level < 30)  return "ancient_city";       // Lv.20-29
  return "ancient_city_deep";                   // Lv.30-40
}

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const intStat = m.int || 0;
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || (level * 800 + vit * 200),
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level, agi: m.agi || 1, int: intStat, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

function gearSummary(equipment) {
  const slots = ["weapon", "shield", "armor", "garment", "shoes",
    "head_top", "head_mid", "head_low", "accessory_l", "accessory_r", "job_eq"];
  let n = 0, tiers = {};
  for (const s of slots) {
    const it = equipment?.[s];
    if (!it) continue;
    n++;
    const t = it.tier || "?";
    tiers[t] = (tiers[t] || 0) + 1;
  }
  const tierStr = Object.keys(tiers).sort().map(k => `${k}${tiers[k]}`).join("");
  return `${n}件(${tierStr || "-"})`;
}

function pad(s, n) { s = String(s); return s + " ".repeat(Math.max(0, n - [...s].length)); }
function padR(s, n) { s = String(s); return " ".repeat(Math.max(0, n - [...s].length)) + s; }
// 中文寬度近似（粗略：非 ASCII 算 2 寬）
function visW(s) { let w = 0; for (const c of String(s)) w += c.charCodeAt(0) > 127 ? 2 : 1; return w; }
function padV(s, n) { s = String(s); const w = visW(s); return s + " ".repeat(Math.max(0, n - w)); }

async function main() {
  const db = await getMongoDb();

  // 拉所有 Lv.2+ 玩家
  const progresses = await db.collection("progress")
    .find({ level: { $gte: 2 } })
    .toArray();

  // 玩家名字
  const playerDocs = await db.collection("players")
    .find({ discordId: { $in: progresses.map(p => p.playerId) } })
    .project({ discordId: 1, displayName: 1, name: 1 })
    .toArray();
  const nameMap = new Map(playerDocs.map(p => [p.discordId, p.displayName || p.name || p.discordId]));

  // 所有怪物（排除 state 文件、停用）
  const allMonsters = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"))
    .filter(m => m.enabled !== false);

  // 依 zone 分組
  const monstersByZone = {};
  for (const m of allMonsters) {
    const z = m.zone || "normal";
    (monstersByZone[z] = monstersByZone[z] || []).push(m);
  }
  for (const k of Object.keys(monstersByZone)) {
    monstersByZone[k].sort((a, b) => (a.level || 0) - (b.level || 0));
  }

  // 玩家按等級排序
  progresses.sort((a, b) => (b.level - a.level) || (a.playerId.localeCompare(b.playerId)));

  // 依等級級距分組顯示
  const byLevel = new Map();
  for (const p of progresses) {
    const lv = p.level;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(p);
  }

  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  console.log(`\n${"═".repeat(120)}`);
  console.log(`跑分測試：MongoDB 內 Lv.2+ 玩家 vs 對應區怪物（每隻 ${RUNS_PER_MONSTER} 場，最多 ${MAX_ROUNDS} 回合）`);
  console.log(`總玩家數：${progresses.length}`);
  console.log("═".repeat(120));

  // 為了避免每等列出 37 個 Lv.40 玩家，分等級彙整 + 列出每位玩家
  const summary = []; // 每個玩家一行
  let processed = 0;

  for (const lv of levels) {
    const zone = pickZoneForLevel(lv);
    const monsters = (monstersByZone[zone] || []);
    const playersOfLv = byLevel.get(lv);

    if (!monsters.length) {
      console.log(`\n【Lv.${lv} → ${zone}】此區尚無怪物，跳過 ${playersOfLv.length} 位玩家`);
      continue;
    }

    console.log(`\n【Lv.${lv} → ${zone}】怪物 ${monsters.length} 隻（Lv.${monsters[0].level}~${monsters[monsters.length - 1].level}），玩家 ${playersOfLv.length} 位`);
    console.log("─".repeat(120));
    console.log([
      padV("玩家", 14), pad("Lv", 3), pad("裝備", 12),
      pad("最低怪", 8), pad("一般王", 8), pad("BOSS", 8),
      pad("清全區", 8), pad("陣亡率", 7),
    ].join("  "));
    console.log("─".repeat(120));

    let gFightsClearZone = 0, gPlayersAlive = 0;

    for (const p of playersOfLv) {
      const attrs = p.attributes || {};
      const equipped = p.equipment || {};
      const ps = calcPlayerStats(attrs, equipped, p.activeEffects || [], p.inventory || [], { pkRating: p.pkRating });

      // 對每隻怪：算平均單場傷害 + 陣亡率 → 推算「打幾場才能擊殺」
      // (玩家死亡的場仍算 1 場，因為要回去療傷重打)
      const perMonster = [];
      let zoneFights = 0;          // 清全區所需總場數
      let zoneDeaths = 0, zoneRuns = 0;

      for (const m of monsters) {
        const mCalc = buildMonsterCalc(m);
        let dmgSum = 0, deaths = 0;
        for (let i = 0; i < RUNS_PER_MONSTER; i++) {
          const r = runCombatLoop(ps, mCalc, m.name, mCalc.maxHp, MAX_ROUNDS, {
            playerLevel: lv,
            equipped,
            inventory: p.inventory || [],
            monsterIsBoss: Boolean(m.isBoss),
          });
          dmgSum += r.totalDamage || 0;
          if (r.outcome === "lose") deaths++;
          zoneRuns++;
        }
        const avgDmg = dmgSum / RUNS_PER_MONSTER;
        const fightsNeeded = avgDmg > 0 ? Math.ceil(mCalc.maxHp / avgDmg) : Infinity;
        perMonster.push({ name: m.name, level: m.level, isBoss: !!m.isBoss, hp: mCalc.maxHp, avgDmg, fightsNeeded, deathRate: deaths / RUNS_PER_MONSTER });
        zoneDeaths += deaths;
        zoneFights += isFinite(fightsNeeded) ? fightsNeeded : 9999;
      }

      // 代表資料：最低等普通怪、最高等普通怪、BOSS
      const normalSorted = perMonster.filter(x => !x.isBoss).sort((a, b) => a.level - b.level);
      const bosses       = perMonster.filter(x => x.isBoss);
      const easiest      = normalSorted[0];
      const hardestN     = normalSorted[normalSorted.length - 1];
      const hardestBoss  = bosses.sort((a, b) => b.level - a.level)[0];

      const fmt = (x) => x ? (isFinite(x.fightsNeeded) ? `${x.fightsNeeded}場` : "∞") : "-";
      const deathRate = (zoneDeaths / zoneRuns * 100).toFixed(0) + "%";
      const name = nameMap.get(p.playerId) || p.playerId.slice(-6);

      console.log([
        padV(name.slice(0, 7), 14),
        pad(lv, 3),
        pad(gearSummary(equipped), 12),
        pad(fmt(easiest), 8),
        pad(fmt(hardestN), 8),
        pad(fmt(hardestBoss), 8),
        pad(isFinite(zoneFights) && zoneFights < 9999 ? `${zoneFights}場` : "∞", 8),
        pad(deathRate, 7),
      ].join("  "));

      gFightsClearZone += (isFinite(zoneFights) && zoneFights < 9999) ? zoneFights : 0;
      if (isFinite(zoneFights) && zoneFights < 9999) gPlayersAlive++;
      processed++;
    }

    const avgClear = gPlayersAlive ? Math.round(gFightsClearZone / gPlayersAlive) : null;
    summary.push({ lv, zone, n: playersOfLv.length, avgClear });
    if (playersOfLv.length > 1) {
      console.log("─".repeat(120));
      console.log(`  Lv.${lv} 平均「清完整區」需 ${avgClear ?? "∞"} 場`);
    }
  }

  console.log(`\n${"═".repeat(120)}`);
  console.log("各等級彙整");
  console.log("═".repeat(120));
  console.log([pad("Lv", 4), pad("Zone", 20), pad("人數", 4), pad("清整區平均場數", 14)].join("  "));
  for (const s of summary) {
    console.log([pad(s.lv, 4), pad(s.zone, 20), pad(s.n, 4), pad(s.avgClear ?? "∞", 14)].join("  "));
  }
  console.log(`\n已處理 ${processed} 位玩家。`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
