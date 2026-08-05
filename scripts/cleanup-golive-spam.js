// 清理 Discord 開台公告洗版（2026-08-02 事故：預約枠誤判 + 公告鎖反覆釋放 → 同一場連發數十則）
// ------------------------------------------------------------------
// 預設 dry-run，只列出「會刪哪些」，不動任何訊息。確認無誤後再加 --apply 真的刪除。
//
// 用法：
//   node scripts/cleanup-golive-spam.js                    # 每個直播網址保留最早那則，其餘列為待刪（dry-run）
//   node scripts/cleanup-golive-spam.js --url=yVrTkWi3     # 只針對含此字串的公告（誤判那場全刪）
//   node scripts/cleanup-golive-spam.js --all              # 不保留，全部列為待刪
//   node scripts/cleanup-golive-spam.js ... --apply        # 真的執行刪除
require("dotenv").config();

const TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = String(process.env.STREAM_GO_LIVE_CHANNEL_ID || "1292448104905441331").trim();
const MARKER = "開始直播摟";               // 開台公告的固定字樣
const API = "https://discord.com/api/v10";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const KEEP_NONE = args.includes("--all");
const URL_FILTER = (args.find((a) => a.startsWith("--url=")) || "").slice(6);

function headers() {
  return { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" };
}

// 顯示一律用台北時間（Discord 回傳是 UTC）
function tpe(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const waitMs = Math.ceil((Number(body.retry_after) || 1) * 1000) + 250;
    console.log(`  …被限流，等 ${waitMs}ms 後重試`);
    await new Promise((r) => setTimeout(r, waitMs));
    return api(path, init);
  }
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// 往回翻整個頻道，撈出所有開台公告
async function fetchAnnouncements() {
  const found = [];
  let before = null;
  let scanned = 0;
  for (let page = 0; page < 100; page++) {
    const q = `limit=100${before ? `&before=${before}` : ""}`;
    const batch = await api(`/channels/${CHANNEL_ID}/messages?${q}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    scanned += batch.length;
    for (const m of batch) {
      if (!String(m.content || "").includes(MARKER)) continue;
      if (URL_FILTER && !String(m.content).includes(URL_FILTER)) continue;
      const url = (String(m.content).match(/https?:\/\/\S+/) || [""])[0];
      found.push({ id: m.id, url, timestamp: m.timestamp, author: m.author?.id });
    }
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  console.log(`掃描 ${scanned} 則訊息，找到 ${found.length} 則開台公告。\n`);
  return found;
}

function plan(all) {
  // Discord 回傳是新→舊，反轉成舊→新，方便「保留最早那則」
  const asc = all.slice().reverse();
  const keep = new Set();
  if (!KEEP_NONE) {
    const seen = new Set();
    for (const m of asc) {
      if (!seen.has(m.url)) { seen.add(m.url); keep.add(m.id); }
    }
  }
  return { keep: asc.filter((m) => keep.has(m.id)), remove: asc.filter((m) => !keep.has(m.id)) };
}

(async () => {
  if (!TOKEN) { console.error("❌ .env 缺少 DISCORD_TOKEN"); process.exit(1); }
  console.log(`頻道 ${CHANNEL_ID}｜模式 ${APPLY ? "🔴 實際刪除" : "🟡 dry-run（不會刪）"}`);
  console.log(`保留策略：${KEEP_NONE ? "全部刪除" : "每個直播網址保留最早一則"}`);
  if (URL_FILTER) console.log(`網址過濾：包含「${URL_FILTER}」`);
  console.log("");

  const all = await fetchAnnouncements();
  if (all.length === 0) { console.log("沒有符合條件的公告，結束。"); process.exit(0); }

  const byUrl = new Map();
  for (const m of all) byUrl.set(m.url, (byUrl.get(m.url) || 0) + 1);
  console.log("依直播網址統計（時間為台北時間）：");
  for (const [url, n] of byUrl) {
    const rows = all.filter((m) => m.url === url).slice().reverse();
    console.log(`  ${n} 則  ${url}`);
    console.log(`        ${tpe(rows[0].timestamp)} ～ ${tpe(rows[rows.length - 1].timestamp)}`);
  }
  console.log("");

  const { keep, remove } = plan(all);
  for (const m of keep) console.log(`  ✅ 保留  ${tpe(m.timestamp)}  ${m.url}`);
  console.log(`\n待刪除 ${remove.length} 則${remove.length
    ? `（台北時間 ${tpe(remove[0].timestamp)} ～ ${tpe(remove[remove.length - 1].timestamp)}）`
    : ""}`);

  if (!APPLY) {
    console.log("\n🟡 這是 dry-run，沒有刪除任何訊息。確認上面清單無誤後，加上 --apply 再跑一次。");
    process.exit(0);
  }

  // 14 天內可用 bulk-delete（一次 2~100 則）；超過 14 天只能逐則刪
  const FOURTEEN_DAYS = 14 * 24 * 3600 * 1000;
  const now = Date.now();
  const fresh = remove.filter((m) => now - Date.parse(m.timestamp) < FOURTEEN_DAYS - 60_000);
  const old = remove.filter((m) => !fresh.includes(m));
  let deleted = 0;

  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100).map((m) => m.id);
    if (chunk.length === 1) {
      await api(`/channels/${CHANNEL_ID}/messages/${chunk[0]}`, { method: "DELETE" });
    } else {
      await api(`/channels/${CHANNEL_ID}/messages/bulk-delete`, {
        method: "POST", body: JSON.stringify({ messages: chunk }),
      });
    }
    deleted += chunk.length;
    console.log(`  已刪 ${deleted}/${remove.length}`);
  }
  for (const m of old) {
    await api(`/channels/${CHANNEL_ID}/messages/${m.id}`, { method: "DELETE" });
    deleted += 1;
    await new Promise((r) => setTimeout(r, 350)); // 逐則刪要放慢，避免限流
    console.log(`  已刪 ${deleted}/${remove.length}（14 天前的訊息逐則刪）`);
  }
  console.log(`\n✅ 完成，共刪除 ${deleted} 則，保留 ${keep.length} 則。`);
  process.exit(0);
})().catch((e) => { console.error("❌ 失敗：", e.message); process.exit(1); });
