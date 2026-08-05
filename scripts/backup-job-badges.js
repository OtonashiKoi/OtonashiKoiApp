"use strict";
/**
 * 職業徽章備份／還原。
 *
 * 徽章是下季平衡的核心資料，改動頻繁又難重建（效果、條件、屬性值全在裡面），
 * 所以每次動之前先存一份，出事可以整包倒回去。
 *
 * 備份存兩個地方：
 *   ‧ DB：storyChapterBackups（跟其他備份同一個地方，方便一起查）
 *   ‧ 檔案：docs/backups/job-badges-<標籤>.json（進 git，看得到 diff）
 *
 * 用法：
 *   node scripts/backup-job-badges.js                     # 列出現有備份
 *   node scripts/backup-job-badges.js --save <標籤> [說明]  # 存一份
 *   node scripts/backup-job-badges.js --restore <標籤>      # 從備份還原（會先自動存一份 pre-restore）
 *   node scripts/backup-job-badges.js --diff <標籤>         # 比對現況與某份備份
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const OUT_DIR = path.join(__dirname, "..", "docs", "backups");
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] || ""); };

const effSig = (b) => [...(b.passiveEffects || []), ...(b.procEffects || []), ...(b.combatEffects || [])]
  .map((e) => `${e.key}=${e.params?.value ?? ""}@${e.chance ?? 100}${e.condition ? ":" + JSON.stringify(e.condition) : ""}`)
  .sort();

async function loadBadges(db) {
  return db.collection("items").find({ itemType: "job_badge" }).sort({ id: 1 }).toArray();
}

(async () => {
  const db = await getMongoDb();
  const col = db.collection("storyChapterBackups");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const saveLabel = flag("--save");
  const restoreLabel = flag("--restore");
  const diffLabel = flag("--diff");

  // ── 存 ──
  if (saveLabel !== null) {
    if (!saveLabel) throw new Error("--save 後面要給標籤，例如 --save 20260803-atkmul-removed");
    const note = argv.slice(argv.indexOf("--save") + 2).join(" ") || "";
    const badges = await loadBadges(db);
    const doc = {
      _id: `backup-job-badges-${saveLabel}`,
      label: saveLabel,
      reason: note || "職業徽章快照",
      createdAt: new Date().toISOString(),
      count: badges.length,
      snapshot: badges,
    };
    await col.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    const file = path.join(OUT_DIR, `job-badges-${saveLabel}.json`);
    fs.writeFileSync(file, JSON.stringify({ label: saveLabel, note, createdAt: doc.createdAt, badges }, null, 2), "utf8");

    console.log(`✅ 已備份 ${badges.length} 個徽章`);
    console.log(`   DB   → storyChapterBackups/${doc._id}`);
    console.log(`   檔案 → docs/backups/job-badges-${saveLabel}.json`);
    if (note) console.log(`   說明 → ${note}`);
    console.log("\n內容摘要：");
    for (const b of badges) {
      const st = b.equipStats || {};
      const tot = Object.values(st).reduce((a, v) => a + (Number(v) || 0), 0);
      console.log(`  ${b.name.padEnd(16)} 屬性總和 ${String(tot).padStart(2)}｜效果 ${effSig(b).length} 條`);
    }
    process.exit(0);
  }

  // ── 比對 ──
  if (diffLabel !== null) {
    const doc = await col.findOne({ _id: `backup-job-badges-${diffLabel}` });
    if (!doc) throw new Error(`找不到備份：${diffLabel}`);
    const now = await loadBadges(db);
    const oldById = Object.fromEntries(doc.snapshot.map((b) => [b.id, b]));
    console.log(`═══ 現況 vs 備份「${diffLabel}」（${doc.createdAt}）═══\n`);
    let changed = 0;
    for (const b of now) {
      const o = oldById[b.id];
      if (!o) { console.log(`  ＋ 新增 ${b.name}`); changed++; continue; }
      const a1 = effSig(o), a2 = effSig(b);
      const gone = a1.filter((x) => !a2.includes(x));
      const add = a2.filter((x) => !a1.includes(x));
      const s1 = JSON.stringify(o.equipStats || {}), s2 = JSON.stringify(b.equipStats || {});
      if (!gone.length && !add.length && s1 === s2) continue;
      changed++;
      console.log(`  ${b.name}`);
      if (s1 !== s2) console.log(`     屬性 ${s1} → ${s2}`);
      gone.forEach((g) => console.log(`     － ${g}`));
      add.forEach((g) => console.log(`     ＋ ${g}`));
    }
    console.log(changed ? `\n共 ${changed} 個徽章有差異` : "\n完全相同");
    process.exit(0);
  }

  // ── 還原 ──
  if (restoreLabel !== null) {
    if (!restoreLabel) throw new Error("--restore 後面要給標籤");
    const doc = await col.findOne({ _id: `backup-job-badges-${restoreLabel}` });
    if (!doc) throw new Error(`找不到備份：${restoreLabel}`);
    // 還原前先自動存一份現況，避免還原本身變成不可逆
    const before = await loadBadges(db);
    const auto = `pre-restore-${Date.now()}`;
    await col.updateOne({ _id: `backup-job-badges-${auto}` },
      { $set: { _id: `backup-job-badges-${auto}`, label: auto, reason: `還原到 ${restoreLabel} 之前的自動備份`, createdAt: new Date().toISOString(), count: before.length, snapshot: before } },
      { upsert: true });
    for (const b of doc.snapshot) {
      const { _id, ...rest } = b;
      await db.collection("items").updateOne({ id: b.id }, { $set: { ...rest, updatedAt: new Date().toISOString() } });
    }
    console.log(`✅ 已還原 ${doc.snapshot.length} 個徽章到「${restoreLabel}」`);
    console.log(`   還原前的現況自動存成：${auto}`);
    process.exit(0);
  }

  // ── 列出 ──
  const list = await col.find({ _id: /^backup-job-badges-/ }).sort({ createdAt: -1 }).toArray();
  console.log(`═══ 職業徽章備份（${list.length} 份）═══\n`);
  if (!list.length) console.log("（還沒有備份。用 --save <標籤> 建一份）");
  list.forEach((d) => console.log(`  ${String(d.label).padEnd(32)} ${d.createdAt.slice(0, 19)}  ${d.count} 個  ${d.reason || ""}`));
  console.log("\n用法：--save <標籤> [說明] ／ --restore <標籤> ／ --diff <標籤>");
  process.exit(0);
})().catch((e) => { console.error("失敗：", e.message); process.exit(1); });
