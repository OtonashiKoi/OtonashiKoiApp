// 把 DB 的 序章 / 第一章 匯出成 Google Sheet 欄位格式(TSV)，供貼回試算表。
// 欄位：NB, STYLE, character, text, branch, SCENE, Character Art, VOICE, effect, BGM, other
require("dotenv").config();
const fs = require("fs");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { getZoneTheme } = require("../src/shared/zones");

const COLS = ["NB", "STYLE", "character", "text", "branch", "SCENE", "Character Art", "VOICE", "effect", "BGM", "other"];
const STYLE = { narration: "MONOLOGUE(獨白)", dialogue: "DIALOGUE(對話)", cg: "CG", battle: "BATTLE(戰鬥)" };

(async () => {
  const db = await getMongoDb();
  const npcs = await db.collection("storyNpcs").find({}).toArray();
  const npcName = Object.fromEntries(npcs.map((n) => [n.id, n.name]));
  const monsters = await db.collection("monsters").find({}).toArray();
  const monName = Object.fromEntries(monsters.map((m) => [m.id, m.name]));
  const assets = await db.collection("storyAssets").find({}).toArray();
  // Cloudinary 換過轉換參數時整條 url 會不同，改用穩定的 public_id(最後一段去副檔名)當鍵。
  const pubId = (url) => { const seg = String(url || "").split("?")[0].split("/").pop() || ""; return seg.replace(/\.[^.]+$/, ""); };
  const urlName = {}, idName = {};
  assets.forEach((a) => { if (a.url) { if (!urlName[a.url]) urlName[a.url] = a.name; const k = pubId(a.url); if (k && !idName[k]) idName[k] = a.name; } });

  const sceneOf = (url) => {
    if (!url) return "";
    const clean = (s) => String(s).replace(/^🗺\s*/, "");
    let name = "";
    const m = url.match(/\/uploads\/zones\/([a-z_]+)\.webp/);
    if (m) name = (getZoneTheme(m[1]) || {}).label || m[1];
    else if (urlName[url]) name = clean(urlName[url]);
    else { const k = pubId(url); if (idName[k]) name = clean(idName[k]); }
    return /[一-鿿]/.test(name) ? name : ""; // 只留有中文的友善名/區域名，技術id一律留空
  };
  const speaker = (n) => {
    if (n.npcId === "player") return "玩家";
    if (typeof n.npcId === "string" && n.npcId.startsWith("mon:")) return monName[n.npcId.slice(4)] || "怪物";
    return n.nameOverride || npcName[n.npcId] || (n.npcId ? "???" : "玩家");
  };
  const portraitName = (npcId) => {
    if (npcId === "player") return "玩家";
    if (typeof npcId === "string" && npcId.startsWith("mon:")) return monName[npcId.slice(4)] || "怪物";
    return npcName[npcId] || "";
  };

  const esc = (s) => String(s == null ? "" : s).replace(/\t/g, " ").replace(/\r?\n/g, " ");

  async function chapterRows(id) {
    const ch = await db.collection("storyChapters").findOne({ id });
    const nodes = ch.nodes || [];
    const rows = [];
    let bgUrl = ch.backgroundUrl || null;        // 背景沿用(往回找最近設定)
    const stage = {};                            // side -> 立繪 npcId（重播台上立繪）
    let curBgm = "";                             // BGM 沿用
    nodes.forEach((n, i) => {
      if (n.backgroundUrl) bgUrl = n.backgroundUrl;
      if (n.clearStage) Object.keys(stage).forEach((k) => delete stage[k]);
      if (n.exitSide === "all") Object.keys(stage).forEach((k) => delete stage[k]);
      else if (n.exitSide) delete stage[n.exitSide];
      if (n.type === "dialogue" && (n.npcId || n.nameOverride)) {
        const side = n.side || "center";
        if (n.npcId) stage[side] = n.npcId; // 主角/NPC/怪物 立繪上台
      }
      if (n.bgm) curBgm = n.bgm === "zone" ? "(地圖曲)" : n.bgm;

      const artNames = Object.values(stage).map(portraitName).filter(Boolean);
      const character = n.type === "battle" ? (monName[n.monsterId] || "")
        : n.type === "narration" ? "玩家"
          : n.type === "cg" ? "" : speaker(n);
      const text = n.type === "battle" ? `⚔️ 戰鬥：${monName[n.monsterId] || "?"}${n.forcedOutcome === "win" ? "（劇情殺·必勝）" : n.forcedOutcome === "lose" ? "（劇情殺·必敗）" : ""}` : (n.text || "");
      const effectParts = [];
      if (n.screenFx) effectParts.push("畫面:" + n.screenFx);
      if (n.textFx) effectParts.push("字:" + n.textFx);
      const otherParts = [];
      if (n.sfx) otherParts.push("音效:" + n.sfx);
      if (n.clearStage) otherParts.push("清台");
      if (n.exitSide) otherParts.push("退場:" + n.exitSide);
      if (n.type === "cg" && n.cgUrl) otherParts.push("CG:" + sceneOf(n.cgUrl));

      rows.push([
        i + 1,
        STYLE[n.type] || n.type,
        esc(character),
        esc(text),
        "",                                   // branch：DB 無，保留空(你自己維護)
        esc(n.type === "cg" ? sceneOf(n.cgUrl) : sceneOf(bgUrl)),
        esc(artNames.join(" / ")),
        "",                                   // VOICE
        esc(effectParts.join(" ")),
        esc(curBgm),
        esc(otherParts.join(" "))
      ]);
    });
    return rows;
  }

  for (const [id, label] of [["chapter-prologue", "序章"], ["chapter-1", "第一章"]]) {
    const rows = await chapterRows(id);
    const tsv = [COLS.join("\t")].concat(rows.map((r) => r.join("\t"))).join("\n");
    const out = `/tmp/backfill-${id}.tsv`;
    fs.writeFileSync(out, tsv, "utf8");
    console.log(`${label} (${id}) → ${rows.length} 列 → ${out}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
