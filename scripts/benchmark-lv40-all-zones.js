// Lv.40 全玩家 × 全關卡跑分（以「平均要打幾次才過」為主軸）
// 期望嘗試次數 = runs / wins；若 wins=0 顯示 ">N"
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { ZONE_DEFS } = require("../src/shared/zones");

const RUNS = Number(process.env.BENCH_RUNS || 30);
const MAX_ROUNDS = 20;
const PLAYER_LEVEL = 40;

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const str = m.str || 1, agi = m.agi || 1, vit = m.vit || 1, dex = m.dex || 1;
  const intStat = m.int || 0;
  return {
    maxHp: m.maxHp || 100,
    atk: str * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : (level * 1) + (vit * 2),
    level, agi, int: intStat, dex, luk: m.luk || 0,
    dodge: Math.min(50, agi * 0.5),
    hit: Math.min(100, 80 + dex),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + agi * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

function jobFromBadge(equipment) {
  const badge = equipment?.job_eq?.itemName || equipment?.job_eq?.name || "";
  return badge.replace("徽章", "") || "無職業";
}

// 期望嘗試次數
function attempts(wins, runs) {
  if (wins <= 0) return Infinity;
  return runs / wins;
}
function fmtAttempts(wins, runs) {
  if (wins <= 0) return `>${runs}`;
  const v = runs / wins;
  if (v < 1.05) return "1.0";
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return v.toFixed(0);
}
function attemptsEmoji(wins, runs) {
  if (wins <= 0) return "💀";
  const v = runs / wins;
  if (v <= 1.1) return "✅";
  if (v <= 1.5) return "👍";
  if (v <= 3) return "⚖️";
  if (v <= 10) return "⚠️";
  return "🔥";
}

async function main() {
  const db = await getMongoDb();
  const progresses = await db.collection("progress").find({ level: PLAYER_LEVEL }).toArray();
  if (!progresses.length) { console.error("找不到任何 Lv.40 玩家"); process.exit(1); }

  const ids = progresses.map((p) => p.playerId);
  const players = await db.collection("players").find({ discordId: { $in: ids } }).toArray();
  const nameById = Object.fromEntries(players.map((p) => [p.discordId, p.displayName || p.name || p.discordId]));

  const monsters = (await db.collection("monsters").find({ zone: { $ne: null } }).sort({ zone: 1, level: 1, seq: 1 }).toArray())
    .filter((m) => m.enabled !== false && m.zone);
  const zoneOrder = ZONE_DEFS.map((z) => z.key).filter((k) => monsters.some((m) => m.zone === k));
  const monstersByZone = Object.fromEntries(zoneOrder.map((z) => [z, monsters.filter((m) => m.zone === z)]));

  console.log(`\n═══ Lv.40 全玩家 × 全關卡跑分（嘗試次數視角）═══`);
  console.log(`玩家 ${progresses.length}、怪物 ${monsters.length}、每組 ${RUNS} 場模擬\n`);

  const outPath = path.join(__dirname, "..", "docs", "benchmark-lv40-report.md");
  const md = [];
  md.push(`# Lv.40 全玩家 × 全關卡跑分報告（嘗試次數視角）`);
  md.push("");
  md.push(`> **期望嘗試次數** = 模擬次數 ÷ 勝場數。例如 1.0 表示通常一次過，3.0 表示平均要打 3 次才過，>30 表示 30 場全敗（實戰可能更難或打不過）。`);
  md.push("");
  md.push(`- 玩家樣本：**${progresses.length}** 位 Lv.40 玩家`);
  md.push(`- 怪物樣本：**${monsters.length}** 隻（${zoneOrder.length} 個 zone）`);
  md.push(`- 每組合模擬次數：**${RUNS}**`);
  md.push(`- 戰鬥最大回合：${MAX_ROUNDS}`);
  md.push(`- 產生時間：${new Date().toISOString()}`);
  md.push("");

  // 統計容器
  const playerSummary = []; // {name, job, ps, byMonster: Map(key -> {wins,runs,rounds})}
  const monsterAgg = new Map(); // key -> {zone,name,level,isBoss, wins,runs,rounds, perPlayerAttempts:[]}

  for (let pi = 0; pi < progresses.length; pi++) {
    const prog = progresses[pi];
    const equipped = {};
    for (const [slot, it] of Object.entries(prog.equipment || {})) {
      if (it) equipped[slot] = { ...it, itemId: it.itemId || it.id, itemName: it.itemName || it.name };
    }
    const ps = calcPlayerStats(prog.attributes || {}, equipped, prog.activeEffects || [], prog.inventory || [], {});
    const job = jobFromBadge(equipped);
    const name = nameById[prog.playerId] || prog.playerId;

    const summary = { name, job, ps, byMonster: new Map(), total: { wins: 0, runs: 0, rounds: 0 } };

    for (const zone of zoneOrder) {
      for (const m of monstersByZone[zone]) {
        const mCalc = buildMonsterCalc(m);
        let wins = 0, rounds = 0;
        for (let i = 0; i < RUNS; i++) {
          const r = runCombatLoop(ps, mCalc, m.name, mCalc.maxHp, MAX_ROUNDS, {
            playerLevel: PLAYER_LEVEL, equipped, inventory: prog.inventory || [], monsterIsBoss: Boolean(m.isBoss),
          });
          if (r.outcome === "win") wins++;
          rounds += r.roundLogs?.length || 0;
        }
        const key = `${zone}|${m.name}|${m.level}`;
        summary.byMonster.set(key, { wins, runs: RUNS, rounds });
        summary.total.wins += wins; summary.total.runs += RUNS; summary.total.rounds += rounds;

        const agg = monsterAgg.get(key) || { zone, name: m.name, level: m.level, isBoss: Boolean(m.isBoss), wins: 0, runs: 0, rounds: 0, perPlayer: [] };
        agg.wins += wins; agg.runs += RUNS; agg.rounds += rounds;
        agg.perPlayer.push({ player: name, job, wins, runs: RUNS });
        monsterAgg.set(key, agg);
      }
    }

    playerSummary.push(summary);
    const avgAttempt = summary.total.wins ? (summary.total.runs / summary.total.wins).toFixed(2) : ">∞";
    console.log(`[${pi + 1}/${progresses.length}] ${name.padEnd(20)} ${job.padEnd(8)} 平均要打 ${avgAttempt} 次才過一隻怪`);
  }

  // ── 1. 每隻怪：跨 Lv40 玩家匯總 ──
  md.push(`## 1. 每隻怪：平均要打幾次才過（跨全體 Lv40 玩家匯總）`);
  md.push("");
  md.push(`> 「全玩家匯總嘗試次數」= 總模擬數 ÷ 總勝場；越大越難。`);
  md.push("");
  md.push(`| # | Zone | 怪物 | Lv | Boss | HP | 樣本數 | 總勝場 | 平均要打幾次 |`);
  md.push(`|---|------|------|----|------|-----|--------|--------|--------------|`);
  const arr = [...monsterAgg.values()].sort((a, b) => attempts(a.wins, a.runs) - attempts(b.wins, b.runs));
  arr.forEach((a, i) => {
    const mHp = monsters.find((m) => m.name === a.name && m.zone === a.zone)?.maxHp ?? "-";
    md.push(`| ${i + 1} | ${a.zone} | ${a.name} | ${a.level} | ${a.isBoss ? "👑" : ""} | ${mHp} | ${a.runs} | ${a.wins} | **${fmtAttempts(a.wins, a.runs)}** ${attemptsEmoji(a.wins, a.runs)} |`);
  });
  md.push("");

  // ── 2. 各 Zone 整體 ──
  md.push(`## 2. 各 Zone 平均嘗試次數`);
  md.push("");
  md.push(`| Zone | 怪物數 | 總模擬 | 總勝場 | 平均要打幾次 |`);
  md.push(`|------|--------|--------|--------|--------------|`);
  for (const zone of zoneOrder) {
    let w = 0, r = 0;
    for (const a of monsterAgg.values()) if (a.zone === zone) { w += a.wins; r += a.runs; }
    const zoneLabel = ZONE_DEFS.find((z) => z.key === zone)?.label || zone;
    md.push(`| ${zoneLabel}（${zone}） | ${monstersByZone[zone].length} | ${r} | ${w} | **${fmtAttempts(w, r)}** ${attemptsEmoji(w, r)} |`);
  }
  md.push("");

  // ── 3. 玩家總覽 ──
  md.push(`## 3. 玩家總覽（按平均嘗試次數，少→多）`);
  md.push("");
  md.push(`| # | 玩家 | 職業 | HP | ATK | flatDef | def% | DODGE | HIT | CRIT | COMBO | 總勝場/總模擬 | 平均要打幾次 |`);
  md.push(`|---|------|------|----|----|---------|------|-------|-----|------|-------|---------------|--------------|`);
  const ranked = [...playerSummary].sort((a, b) => attempts(a.total.wins, a.total.runs) - attempts(b.total.wins, b.total.runs));
  ranked.forEach((s, i) => {
    md.push(`| ${i + 1} | ${s.name} | ${s.job} | ${s.ps.maxHp} | ${s.ps.atk} | ${s.ps.flatDef} | ${s.ps.def}% | ${Math.round(s.ps.dodge)}% | ${Math.round(s.ps.hit)}% | ${Math.round(s.ps.crit)}% | ${Math.round(s.ps.combo)}% | ${s.total.wins}/${s.total.runs} | **${fmtAttempts(s.total.wins, s.total.runs)}** ${attemptsEmoji(s.total.wins, s.total.runs)} |`);
  });
  md.push("");

  // ── 4. 職業匯總 ──
  md.push(`## 4. 職業匯總`);
  md.push("");
  const byJob = {};
  for (const s of playerSummary) {
    if (!byJob[s.job]) byJob[s.job] = { count: 0, wins: 0, runs: 0, hp: 0, atk: 0 };
    byJob[s.job].count++;
    byJob[s.job].wins += s.total.wins; byJob[s.job].runs += s.total.runs;
    byJob[s.job].hp += s.ps.maxHp; byJob[s.job].atk += s.ps.atk;
  }
  md.push(`| 職業 | 人數 | 平均HP | 平均ATK | 總勝場/總模擬 | 平均要打幾次 |`);
  md.push(`|------|------|--------|---------|---------------|--------------|`);
  Object.entries(byJob).sort((a, b) => attempts(a[1].wins, a[1].runs) - attempts(b[1].wins, b[1].runs)).forEach(([j, x]) => {
    md.push(`| ${j} | ${x.count} | ${(x.hp / x.count).toFixed(0)} | ${(x.atk / x.count).toFixed(0)} | ${x.wins}/${x.runs} | **${fmtAttempts(x.wins, x.runs)}** ${attemptsEmoji(x.wins, x.runs)} |`);
  });
  md.push("");

  // ── 5. 玩家 × 怪物 矩陣（嘗試次數）──
  md.push(`## 5. 玩家 × 怪物 嘗試次數矩陣`);
  md.push("");
  md.push(`> 每格 = 該玩家打那隻怪的期望嘗試次數。`);
  md.push("");
  const monsterCols = [...monsterAgg.values()].sort((a, b) => zoneOrder.indexOf(a.zone) - zoneOrder.indexOf(b.zone) || a.level - b.level || a.name.localeCompare(b.name));
  md.push(`| 玩家 | 職業 | ` + monsterCols.map((m) => `${m.name}(L${m.level})`).join(" | ") + " |");
  md.push(`|------|------|` + monsterCols.map(() => "------").join("|") + "|");
  for (const s of ranked) {
    const cells = monsterCols.map((m) => {
      const key = `${m.zone}|${m.name}|${m.level}`;
      const r = s.byMonster.get(key);
      if (!r) return "-";
      return fmtAttempts(r.wins, r.runs);
    });
    md.push(`| ${s.name} | ${s.job} | ${cells.join(" | ")} |`);
  }
  md.push("");

  // ── 6. 觀察 ──
  md.push(`## 6. 觀察重點`);
  md.push("");
  const overallW = playerSummary.reduce((a, s) => a + s.total.wins, 0);
  const overallR = playerSummary.reduce((a, s) => a + s.total.runs, 0);
  md.push(`- **整體**：全 Lv40 玩家對全怪物，平均要打 **${fmtAttempts(overallW, overallR)}** 次才過一隻怪`);
  const easiest = arr[0];
  const hardest = arr[arr.length - 1];
  md.push(`- **最簡單怪物**：${easiest.name}（${easiest.zone} L${easiest.level}）→ ${fmtAttempts(easiest.wins, easiest.runs)} 次`);
  md.push(`- **最難怪物**：${hardest.name}（${hardest.zone} L${hardest.level}）→ ${fmtAttempts(hardest.wins, hardest.runs)} 次`);
  const undefeated = arr.filter((a) => a.wins === 0);
  if (undefeated.length) {
    md.push(`- **${RUNS} 場全敗的怪物**（${undefeated.length} 隻）：${undefeated.map((u) => `${u.name}(${u.zone} L${u.level})`).join("、")}`);
  }
  md.push("");

  fs.writeFileSync(outPath, md.join("\n"), "utf8");
  console.log(`\n報告已寫入：${outPath}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
