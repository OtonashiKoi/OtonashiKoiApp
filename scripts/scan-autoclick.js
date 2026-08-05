// 連點/掛機外掛偵測掃描（唯讀，不改任何資料）
// ------------------------------------------------------------------
// 判斷依據是「續航力」不是「節奏規律度」：戰鬥有固定演出時間，出手間隔被遊戲節奏決定，
// 連點器和真人的間隔變異都很大 → 節奏分不出來。人會休息、程式不會，才是真正的分界。
//
// 資料來源：transactions 的 `level:exp-overflow`（滿等玩家每場戰鬥一筆）。
// ⚠️ 盲區：**只涵蓋滿等玩家**，未滿等的帳號這份資料看不到。
//
// 用法：
//   node scripts/scan-autoclick.js          # 近 14 天
//   node scripts/scan-autoclick.js 30       # 近 30 天
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const DAYS = Number(process.argv[2] || 14);
const GAP_MS = 10 * 60_000;          // 超過 10 分鐘沒動作＝休息過一次
const SUSPECT_HOURS = 4;             // 單段連續遊玩超過這個時數就列為可疑
const tpe = (ms) => new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei", hour12: false,
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(ms));

function splitSessions(ts) {
  const sessions = [];
  let start = ts[0];
  let count = 1;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] <= GAP_MS) { count += 1; continue; }
    sessions.push({ start, end: ts[i - 1], count });
    start = ts[i];
    count = 1;
  }
  sessions.push({ start, end: ts[ts.length - 1], count });
  return sessions;
}

(async () => {
  const db = await getMongoDb();
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
  const rows = await db.collection("transactions")
    .find({ source: "level:exp-overflow", createdAt: { $gte: since } },
      { projection: { playerId: 1, createdAt: 1 } })
    .toArray();

  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, []);
    byPlayer.get(r.playerId).push(Date.parse(r.createdAt));
  }

  const report = [];
  for (const [pid, raw] of byPlayer) {
    const ts = raw.sort((a, b) => a - b);
    if (ts.length < 100) continue;
    const sessions = splitSessions(ts);
    const longest = sessions.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    report.push({
      pid,
      total: ts.length,
      activeHours: sessions.reduce((a, s) => a + (s.end - s.start), 0) / 3600_000,
      longest,
      longHours: (longest.end - longest.start) / 3600_000,
      overCount: sessions.filter((s) => (s.end - s.start) >= SUSPECT_HOURS * 3600_000).length,
    });
  }
  report.sort((a, b) => b.longHours - a.longHours);

  const players = db.collection("players");
  const humanCheck = require("../src/services/humanCheck/humanCheckService");

  console.log(`近 ${DAYS} 天｜連續 ${GAP_MS / 60000} 分鐘內不斷手＝一段連線｜單段 ≥${SUSPECT_HOURS}h 列為可疑\n`);
  console.log("玩家".padEnd(20) + "總場次".padStart(8) + "活躍".padStart(8) + "最長段".padStart(8)
    + "該段場次".padStart(9) + "可疑段".padStart(7) + "  驗證(發/過/失)  最長那段（台北時間）");
  console.log("-".repeat(118));

  let suspects = 0;
  for (const r of report.slice(0, 20)) {
    const p = await players.findOne({ discordId: r.pid }, { projection: { name: 1, nickname: 1 } });
    const name = String(p?.nickname || p?.name || r.pid).slice(0, 16);
    const hc = await humanCheck.peek(r.pid);
    const s = hc?.stats || {};
    const hcCol = `${s.challenges || 0}/${s.passes || 0}/${s.fails || 0}`;
    const flag = r.overCount > 0 ? "⚠️" : "  ";
    if (r.overCount > 0) suspects += 1;
    console.log(flag + name.padEnd(18) + String(r.total).padStart(8)
      + (r.activeHours.toFixed(1) + "h").padStart(8)
      + (r.longHours.toFixed(1) + "h").padStart(8)
      + String(r.longest.count).padStart(9)
      + String(r.overCount).padStart(7)
      + "  " + hcCol.padEnd(14)
      + tpe(r.longest.start) + " ～ " + tpe(r.longest.end));
  }

  console.log(`\n⚠️ 標記＝有 ${SUSPECT_HOURS} 小時以上完全沒中斷的連續段，共 ${suspects} 人。`);
  console.log("判讀：連續 4 小時以上一次 10 分鐘的休息都沒有，生理上說不通；驗證欄的「失」次數是直接證據。");
  console.log("提醒：本掃描只看得到滿等玩家（exp-overflow 交易），未滿等帳號不在範圍內。");
  process.exit(0);
})().catch((e) => { console.error("❌ 掃描失敗：", e.message); process.exit(1); });
