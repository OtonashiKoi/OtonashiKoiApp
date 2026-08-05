"use strict";
/**
 * 把轉職劇本（Markdown）匯入成 storyChapters —— 支援 Notion 匯出的檔案。
 *
 * 工作流：
 *   docs/JOB_STORY_SCRIPTS.md → 匯入 Notion → 在 Notion 改寫 → 匯出 Markdown → 這支腳本 → DB
 *
 * Notion 匯出的容錯（都會自動處理）：
 *   ‧ 全形／半形冒號混用（「旁白：」「旁白:」）
 *   ‧ Notion 會把行首 `-` 轉成 bullet，匯出時可能變成 `- ` 或 `* `
 *   ‧ 標題被加上編號前綴、或 `#` 層級改變
 *   ‧ 粗體/斜體標記（**文字**）→ 一律去掉，劇情文字不吃 markdown
 *   ‧ 全形括號的節點標記（［選擇］）
 *
 * 用法：
 *   node scripts/import-job-stories.js                       # 試跑（讀預設檔）
 *   node scripts/import-job-stories.js --apply               # 寫入 DB（enabled:false）
 *   node scripts/import-job-stories.js path/to/notion.md --apply
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const SRC = args[0] ? path.resolve(args[0]) : path.join(__dirname, "..", "docs", "JOB_STORY_SCRIPTS.md");

// 職業 → { chapterId, npcId, monsterId, order }
const JOBS = {
  "劍士": { key: "swordsman", order: 301 },
  "戰士": { key: "warrior", order: 302 },
  "矮人戰士": { key: "dwarf-warrior", order: 303 },
  "盜賊": { key: "rogue", order: 304 },
  "法師": { key: "mage", order: 305 },
  "治療師": { key: "healer", order: 306 },
  "弓箭手": { key: "archer", order: 307 },
  "軍師": { key: "tactician", order: 308 },
  "詩人": { key: "bard", order: 309 },
  "結界師": { key: "barrier-mage", order: 310 },
  "賭徒": { key: "gambler", order: 311 },
};

// ── 正規化：把 Notion 可能改動的寫法拉回統一格式 ──
const normalize = (line) => line
  .replace(/ /g, " ")                 // Notion 愛用的不斷行空格
  .replace(/^\s*[-*]\s+/, "- ")            // bullet 統一
  .replace(/\*\*(.+?)\*\*/g, "$1")         // 去粗體
  .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1") // 去斜體
  .replace(/［/g, "[").replace(/］/g, "]")  // 全形方括號
  .replace(/：/g, "：")                     // 保持全形冒號
  .trim();

function parse(md) {
  const chapters = [];
  let cur = null;
  let branch = "";
  const warn = [];

  for (const raw of md.split(/\r?\n/)) {
    const line = normalize(raw);
    if (!line) continue;

    // 章節標題：# 1. 劍士 → 聖劍士／劍鬼　｜引路人：白鷺
    //（Notion 可能改成 ## 或加編號，所以只要求「開頭是 #、含職業名、含『引路人』」）
    if (/^#{1,3}\s/.test(line) && /引路人/.test(line)) {
      // 長名優先：不然「矮人戰士」會被「戰士」的子字串比對搶走
      const jobName = Object.keys(JOBS)
        .sort((a, b) => b.length - a.length)
        .find((j) => new RegExp(`(^|[\\s.])${j}(?=\\s|→|$)`).test(line.replace(/^#{1,3}\s*/, "")));
      const guide = (line.match(/引路人[：:]\s*(.+?)\s*$/) || [])[1] || "";
      if (!jobName) { warn.push(`認不出職業的標題：${line}`); cur = null; continue; }
      const titleBody = line.replace(/^#{1,3}\s*/, "").replace(/^\d+\.\s*/, "").replace(/\s*｜.*$/, "");
      cur = { job: jobName, guide, title: `轉職・${titleBody}`, nodes: [], branch: "" };
      chapters.push(cur);
      branch = "";
      continue;
    }
    if (!cur) continue;
    if (/^#{1,6}\s/.test(line) || line.startsWith("|") || line.startsWith(">") || /^-{3,}$/.test(line)) continue;

    const mBranch = line.match(/^\[分支[:：](.+?)\]$/);
    if (mBranch) {
      // 前一條分支若已經走完（有 [進化]），它的最後一個節點必須跳到結尾，
      // 否則玩家會直接掉進下一條分支（choice 只跳轉、不記變數）。
      // 這個出口不要求劇本自己寫，解析時自動補。
      if (branch && cur.nodes.some((n) => n.type === "transfer")) {
        for (let i = cur.nodes.length - 1; i >= 0; i--) {
          const n = cur.nodes[i];
          if (n._label) break;
          if (n.type) { n.jumpTo = "ending"; break; }
        }
      }
      branch = mBranch[1].trim();
      cur.nodes.push({ _label: branch });
      continue;
    }
    if (/^\[合流\]$/.test(line)) { branch = "ending"; cur.nodes.push({ _label: "ending" }); continue; }

    const mChoice = line.match(/^\[選擇\]\s*(.*)$/);
    if (mChoice) { cur.nodes.push({ type: "choice", text: mChoice[1], options: [] }); continue; }

    const mOpt = line.match(/^-\s*(.+?)\s*→\s*(.+)$/);
    if (mOpt) {
      const last = cur.nodes[cur.nodes.length - 1];
      if (last && last.type === "choice") { last.options.push({ text: mOpt[1].trim(), jumpTo: mOpt[2].trim() }); continue; }
      warn.push(`選項沒有接在 [選擇] 後面：${line}`);
      continue;
    }

    const mBattle = line.match(/^\[戰鬥\]\s*(.*)$/);
    if (mBattle) { cur.nodes.push({ type: "battle", text: mBattle[1], mustWin: true, _branch: branch }); continue; }

    const mTr = line.match(/^\[進化\]\s*(\S+)\s*[｜|]\s*(.*)$/);
    if (mTr) { cur.nodes.push({ type: "transfer", t2BadgeId: mTr[1].trim(), text: mTr[2].trim(), _branch: branch }); continue; }

    const mLine = line.match(/^(.{1,12}?)[：:]\s*(.*)$/);
    if (mLine) {
      const who = mLine[1].trim();
      const text = mLine[2].trim();
      if (!text) continue;
      if (who === "旁白") cur.nodes.push({ type: "narration", text });
      else if (who === "你" || who === "玩家") cur.nodes.push({ type: "dialogue", npcId: "player", text });
      else cur.nodes.push({ type: "dialogue", _guide: true, side: "left", text });
      continue;
    }
    // 沒有冒號的行 → 當旁白
    cur.nodes.push({ type: "narration", text: line });
  }
  return { chapters, warn };
}

(async () => {
  if (!fs.existsSync(SRC)) throw new Error(`找不到劇本檔：${SRC}`);
  const { chapters, warn } = parse(fs.readFileSync(SRC, "utf8"));
  if (!chapters.length) throw new Error("沒有解析到任何章節");

  const db = await getMongoDb();
  const col = db.collection("storyChapters");
  const monsters = db.collection("monsters");

  console.log(`═══ 匯入轉職劇本 ═══\n來源：${path.relative(process.cwd(), SRC)}\n`);
  const problems = [...warn];
  const docs = [];

  for (const ch of chapters) {
    const meta = JOBS[ch.job];
    const npcId = `npc-master-${meta.key}`;
    const monId = `master-${meta.key}`;
    if (!(await monsters.findOne({ id: monId }))) problems.push(`${ch.job}：找不到試煉對手 ${monId}`);

    // 收束：把 _label / _guide / _branch 這些解析用欄位轉成正式節點欄位
    const nodes = [];
    for (const n of ch.nodes) {
      if (n._label) { nodes._pendingLabel = n._label; continue; }
      const node = { ...n };
      delete node._guide; delete node._branch;
      if (node.type === "dialogue" && n._guide) node.npcId = npcId;
      if (node.type === "battle") node.monsterId = monId, node.battleTitle = ch.guide;
      if (nodes._pendingLabel) { node.label = nodes._pendingLabel; delete nodes._pendingLabel; }
      nodes.push(node);
    }

    // 驗證
    const labels = new Set(nodes.map((n) => n.label).filter(Boolean));
    for (const n of nodes) {
      if (n.type !== "choice") continue;
      if (n.options.length < 2) problems.push(`${ch.job}：選項不足兩個`);
      for (const o of n.options) if (!labels.has(o.jumpTo)) problems.push(`${ch.job}：選項跳轉找不到分支「${o.jumpTo}」`);
    }
    const transfers = nodes.filter((n) => n.type === "transfer");
    if (!transfers.length) problems.push(`${ch.job}：沒有 [進化] 節點，玩家轉不了職`);
    if (new Set(transfers.map((n) => n.t2BadgeId)).size !== transfers.length) problems.push(`${ch.job}：[進化] 徽章重複`);
    for (const t of transfers) {
      if (!(await db.collection("items").findOne({ id: t.t2BadgeId }))) problems.push(`${ch.job}：徽章不存在 ${t.t2BadgeId}`);
    }
    const choices = nodes.filter((n) => n.type === "choice");
    if (choices.length && transfers.length < 2) {
      problems.push(`${ch.job}：有分支卻只有 1 個 [進化] → 會發錯徽章（兩條線各要一個）`);
    }
    // 最後一個分支要有出口，不然會掉進另一條分支
    if (choices.length) {
      const firstTr = nodes.findIndex((n) => n.type === "transfer");
      const secondBranchStart = nodes.findIndex((n, i) => i > firstTr && n.label && n.label !== "ending");
      if (secondBranchStart !== -1) {
        const between = nodes.slice(firstTr, secondBranchStart);
        if (!between.some((n) => n.jumpTo)) problems.push(`${ch.job}：第一條分支結尾沒有 jumpTo「ending」→ 會直接掉進另一條分支`);
      }
    }

    docs.push({
      id: `job-story-${meta.key}`,
      order: meta.order,
      zoneKey: null,
      title: ch.title,
      enabled: false,
      nodes,
      updatedAt: new Date().toISOString(),
    });
    const c = (t) => nodes.filter((n) => n.type === t).length;
    console.log(`  ${ch.job.padEnd(6)} ${ch.guide.padEnd(6)} ${String(nodes.length).padStart(3)} 節點｜對話 ${c("dialogue")}｜旁白 ${c("narration")}｜選項 ${c("choice")}｜戰鬥 ${c("battle")}｜進化 ${c("transfer")}`);
  }

  if (problems.length) {
    console.log(`\n⚠️ 發現 ${problems.length} 個問題：`);
    problems.forEach((p) => console.log("  ・" + p));
    if (APPLY) { console.log("\n❌ 有問題，不寫入。修好再跑一次。"); process.exit(1); }
  } else {
    console.log("\n✅ 檢查全過");
  }

  if (APPLY) {
    for (const d of docs) {
      const existing = await col.findOne({ id: d.id });
      if (existing) await col.updateOne({ id: d.id }, { $set: d });
      else await col.insertOne({ ...d, createdAt: new Date().toISOString() });
    }
    console.log(`\n✅ 已寫入 ${docs.length} 章（全部 enabled:false，未開放）`);
  } else {
    console.log("\n（試跑，加 --apply 才寫入）");
  }
  process.exit(0);
})().catch((e) => { console.error("失敗：", e.message); process.exit(1); });
