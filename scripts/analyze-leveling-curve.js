"use strict";
/**
 * 升等曲線分析：從 Lv1 練到滿等（Lv50）實際要多久？
 *
 * 不憑感覺——用三份真實資料算：
 *   ① 經驗曲線：shared/progression.expToNextLevel
 *   ② 各區怪物的實際 expReward（DB）
 *   ③ 真實玩家的打怪節奏（從 monsterState.killCount 與實際玩家等級回推）
 *
 * 用法：node scripts/analyze-leveling-curve.js [每日場次]
 */

require("dotenv").config();
const { expToNextLevel, MAX_LEVEL } = require("../src/shared/progression");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { ZONE_BY_KEY } = require("../src/shared/zones");

const BATTLES_PER_DAY = Number(process.argv[2]) || 0;   // 0 = 用實測值推

(async () => {
  const db = await getMongoDb();

  // ── ① 經驗曲線 ──
  const need = [];
  let cum = 0;
  for (let lv = 1; lv < MAX_LEVEL; lv++) { const e = expToNextLevel(lv); need.push({ lv, e, cum: (cum += e) }); }
  const TOTAL_EXP = cum;

  console.log("═══ 升等曲線分析 ═══\n");
  console.log("【經驗曲線】");
  for (const lv of [1, 10, 20, 30, 35, 40, 45, 49]) {
    const r = need.find((x) => x.lv === lv);
    console.log(`  Lv${String(lv).padStart(2)}→${lv + 1}  需 ${r.e.toLocaleString().padStart(11)}　累計 ${r.cum.toLocaleString()}`);
  }
  console.log(`  ── Lv1→50 總計 ${TOTAL_EXP.toLocaleString()} 經驗\n`);

  // ── ② 各區怪物經驗 ──
  const monsters = await db.collection("monsters").find({ enabled: true, isBoss: { $ne: true } }).toArray();
  const byZone = {};
  for (const m of monsters) {
    const z = m.zone || "?";
    (byZone[z] = byZone[z] || []).push(m);
  }
  console.log("【各區經驗（實際 DB 值）】");
  const zoneRows = [];
  for (const [z, list] of Object.entries(byZone)) {
    const exp = list.map((m) => m.expReward || 0);
    const lv = list.map((m) => m.level || 0);
    const avgExp = exp.reduce((a, b) => a + b, 0) / exp.length;
    const label = ZONE_BY_KEY[z]?.label || z;
    zoneRows.push({ z, label, avgExp, lvMin: Math.min(...lv), lvMax: Math.max(...lv) });
  }
  zoneRows.sort((a, b) => a.lvMin - b.lvMin);
  zoneRows.forEach((r) => console.log(`  ${r.label.padEnd(14)}Lv${r.lvMin}~${r.lvMax}　平均 ${Math.round(r.avgExp).toLocaleString()} 經驗/場`));

  // ── ③ 真實玩家節奏 ──
  // 從 progress 的 createdAt → 現在等級，回推「實際上花了幾天到目前等級」
  const players = await db.collection("progress").find({ level: { $gte: 20 } })
    .project({ level: 1, exp: 1, createdAt: 1, updatedAt: 1 }).toArray();
  const paces = [];
  for (const p of players) {
    const start = Date.parse(p.createdAt || "");
    const end = Date.parse(p.updatedAt || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const days = (end - start) / 86400000;
    if (days < 1) continue;
    const cumExp = (need.find((x) => x.lv === p.level - 1)?.cum || 0) + (p.exp || 0);
    paces.push({ level: p.level, days, expPerDay: cumExp / days });
  }
  paces.sort((a, b) => b.expPerDay - a.expPerDay);
  const median = paces.length ? paces[Math.floor(paces.length / 2)] : null;
  const top = paces[0];

  console.log(`\n【真實玩家節奏】（${paces.length} 位 Lv20+ 玩家，用建號至今的天數回推）`);
  if (median) {
    console.log(`  中位數：${Math.round(median.expPerDay).toLocaleString()} 經驗/天（Lv${median.level}，玩了 ${median.days.toFixed(0)} 天）`);
    console.log(`  最快：  ${Math.round(top.expPerDay).toLocaleString()} 經驗/天（Lv${top.level}，玩了 ${top.days.toFixed(0)} 天）`);
  }

  // ── ④ 推算滿等天數 ──
  console.log("\n【滿等（Lv50）需要多久】");
  const scenarios = [];
  if (median) scenarios.push(["實測中位玩家", median.expPerDay]);
  if (top) scenarios.push(["實測最快玩家", top.expPerDay]);
  // 依打怪速度模擬：每場 X 經驗 × 每日場次
  const zoneMid = zoneRows.find((r) => r.z === "ancient_city") || zoneRows[Math.floor(zoneRows.length / 2)];
  const zoneHigh = zoneRows.find((r) => r.z === "dragon_realm") || zoneRows[zoneRows.length - 1];
  for (const bpd of (BATTLES_PER_DAY ? [BATTLES_PER_DAY] : [50, 100, 200])) {
    scenarios.push([`每天 ${bpd} 場（${zoneMid.label}）`, zoneMid.avgExp * bpd]);
    scenarios.push([`每天 ${bpd} 場（${zoneHigh.label}）`, zoneHigh.avgExp * bpd]);
  }
  for (const [label, perDay] of scenarios) {
    if (!(perDay > 0)) continue;
    const days = TOTAL_EXP / perDay;
    const flag = days > 180 ? " ⚠️ 超過半年" : days > 90 ? " ⚠️ 超過三個月" : "";
    console.log(`  ${label.padEnd(26)}${Math.round(perDay).toLocaleString().padStart(10)} 經驗/天 → ${days.toFixed(0).padStart(4)} 天${flag}`);
  }

  // ── ⑤ 卡在哪一段 ──
  console.log("\n【哪一段最花時間】（以中位玩家的經驗/天計）");
  if (median) {
    const segs = [[1, 20], [20, 35], [35, 45], [45, 50]];
    for (const [a, b] of segs) {
      const e = need.filter((x) => x.lv >= a && x.lv < b).reduce((s, x) => s + x.e, 0);
      console.log(`  Lv${a}→${b}　${e.toLocaleString().padStart(12)} 經驗　${(e / median.expPerDay).toFixed(0).padStart(4)} 天　（占總量 ${((e / TOTAL_EXP) * 100).toFixed(0)}%）`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error("失敗：", e); process.exit(1); });
