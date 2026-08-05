"use strict";
/**
 * 把 docs/JOB_STORY_SCRIPTS.md 的 11 段轉職劇本轉成 Google Sheet 欄位格式（TSV），
 * 供貼成試算表的新分頁。欄位與 export-story-to-sheet-tsv.js 完全一致。
 *
 * 為什麼從 markdown 出發：這 11 段還沒寫進 DB（使用者要先在文字檔上修改），
 * 所以直接解析劇本檔，不經過 storyChapters。
 *
 * 用法：
 *   node scripts/export-job-stories-tsv.js               # 全部 11 段合成一張表
 *   node scripts/export-job-stories-tsv.js --split       # 每個職業各一個檔（各自一個分頁）
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "docs", "JOB_STORY_SCRIPTS.md");
const OUT_DIR = path.join(__dirname, "..", "docs", "story-tsv");
const SPLIT = process.argv.includes("--split");

const COLS = ["NB", "STYLE", "character", "text", "branch", "SCENE", "Character Art", "VOICE", "effect", "BGM", "other"];
const STYLE = {
  narration: "MONOLOGUE(獨白)",
  dialogue: "DIALOGUE(對話)",
  battle: "BATTLE(戰鬥)",
  choice: "CHOICE(選項)",
  transfer: "TRANSFER(轉職)",
};

const esc = (s) => String(s == null ? "" : s).replace(/\t/g, " ").replace(/\r?\n/g, " ");

/** 解析劇本檔 → [{ title, job, guide, rows }] */
function parse(md) {
  const chapters = [];
  let cur = null;
  let branch = "";            // 目前所在分支（branch 欄）
  const lines = md.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();

    // 章節標題：# 1. 劍士 → 聖劍士／劍鬼　｜引路人：白鷺
    const mTitle = line.match(/^#\s+(\d+)\.\s*(.+?)\s*｜\s*引路人：(.+)$/);
    if (mTitle) {
      cur = { no: Number(mTitle[1]), title: mTitle[2].trim(), guide: mTitle[3].trim(), rows: [] };
      chapters.push(cur);
      branch = "";
      continue;
    }
    if (!cur || !line) continue;
    if (line.startsWith("---") || line.startsWith("#") || line.startsWith("|") || line.startsWith(">")) continue;

    // [分支:代號] / [合流]
    const mBranch = line.match(/^\[分支:(.+?)\]$/);
    if (mBranch) { branch = mBranch[1].trim(); continue; }
    if (line === "[合流]") { branch = ""; continue; }

    // [選擇] 提示 ／ 其下的 - 選項 → 代號
    const mChoice = line.match(/^\[選擇\]\s*(.*)$/);
    if (mChoice) {
      cur.rows.push({ style: "choice", character: "", text: mChoice[1], branch, other: "" });
      continue;
    }
    const mOpt = line.match(/^-\s*(.+?)\s*→\s*(.+)$/);
    if (mOpt && cur.rows.length && cur.rows[cur.rows.length - 1].style === "choice") {
      const last = cur.rows[cur.rows.length - 1];
      last.other = (last.other ? last.other + " ／ " : "") + `選項：${mOpt[1]} → ${mOpt[2]}`;
      continue;
    }

    // [戰鬥] 旁白
    const mBattle = line.match(/^\[戰鬥\]\s*(.*)$/);
    if (mBattle) {
      cur.rows.push({ style: "battle", character: cur.guide, text: `⚔️ 戰鬥：${cur.guide}　${mBattle[1]}`, branch, other: "必勝(mustWin)" });
      continue;
    }

    // [進化] 徽章id ｜ 旁白
    const mTr = line.match(/^\[進化\]\s*(\S+)\s*｜\s*(.*)$/);
    if (mTr) {
      cur.rows.push({ style: "transfer", character: "", text: `✨ 徽章進化：${mTr[2]}`, branch, other: `換發：${mTr[1]}　消耗一轉徽章＋變更登記費` });
      continue;
    }

    // 台詞：角色：文字
    const mLine = line.match(/^(.+?)：(.*)$/);
    if (mLine) {
      const who = mLine[1].trim();
      const text = mLine[2].trim();
      if (who === "旁白") cur.rows.push({ style: "narration", character: "玩家", text, branch, other: "" });
      else cur.rows.push({ style: "dialogue", character: who, text, branch, other: "" });
      continue;
    }
  }
  return chapters;
}

function toTsv(chapters, withChapterCol = false) {
  const header = (withChapterCol ? ["CHAPTER"] : []).concat(COLS);
  const out = [header.join("\t")];
  for (const ch of chapters) {
    ch.rows.forEach((r, i) => {
      const row = [
        i + 1,
        STYLE[r.style] || r.style,
        esc(r.character),
        esc(r.text),
        esc(r.branch),
        "",                 // SCENE：背景待美術定
        esc(r.style === "dialogue" && r.character !== "你" ? r.character : ""),
        "",                 // VOICE
        "",                 // effect
        "",                 // BGM
        esc(r.other),
      ];
      out.push((withChapterCol ? [esc(`${ch.no}.${ch.title}`)] : []).concat(row).join("\t"));
    });
  }
  return out.join("\n");
}

(() => {
  const md = fs.readFileSync(SRC, "utf8");
  const chapters = parse(md);
  if (!chapters.length) throw new Error("沒有解析到任何章節，檢查劇本檔格式");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("═══ 轉職劇本 → TSV ═══");
  if (SPLIT) {
    for (const ch of chapters) {
      const name = `job-${String(ch.no).padStart(2, "0")}-${ch.title.split(" ")[0].replace(/[→／\/]/g, "-")}.tsv`;
      const p = path.join(OUT_DIR, name);
      fs.writeFileSync(p, toTsv([ch]), "utf8");
      console.log(`  ${String(ch.no).padStart(2)}. ${ch.title.padEnd(22)} ${String(ch.rows.length).padStart(3)} 列 → docs/story-tsv/${name}`);
    }
  } else {
    const p = path.join(OUT_DIR, "job-stories-all.tsv");
    fs.writeFileSync(p, toTsv(chapters, true), "utf8");
    const total = chapters.reduce((s, c) => s + c.rows.length, 0);
    chapters.forEach((c) => console.log(`  ${String(c.no).padStart(2)}. ${c.title.padEnd(22)} ${String(c.rows.length).padStart(3)} 列`));
    console.log(`\n合計 ${total} 列 → docs/story-tsv/job-stories-all.tsv`);
    console.log("（第一欄 CHAPTER 標示屬於哪一段，方便在試算表裡篩選）");
  }
})();
