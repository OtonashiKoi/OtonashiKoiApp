// 依 Google Sheet(gid=1121808141) 匯出的 /tmp/sheet-gid.csv 重建「第一章」節點。
// 對映：MONOLOGUE→旁白 / DIALOGUE→對話 / CG→CG / BATTLE→戰鬥。
// 角色：玩家→主角(player)、系統/？？？→nameOverride、其餘→對應 NPC 卡；戰鬥→怪物+劇情殺(必勝/必敗)。
// 背景：SCENE 名稱若對得到圖庫友善名/地圖，於換景時自動設 backgroundUrl；對不到留空(進後台補)。
// 匯入前先把現有 chapter-1 備份到 storyChapterBackups。可重跑。
require("dotenv").config();
const fs = require("fs");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

(async () => {
  const db = await getMongoDb();
  const npcs = await db.collection("storyNpcs").find({}).toArray();
  const npcIdByName = Object.fromEntries(npcs.map((n) => [n.name, n.id]));
  const monsters = await db.collection("monsters").find({}).toArray();
  const monIdByName = Object.fromEntries(monsters.map((m) => [m.name, m.id]));
  const assets = await db.collection("storyAssets").find({}).toArray();
  const sceneUrl = {};
  assets.forEach((a) => { const k = String(a.name || "").replace(/^🗺\s*/, "").trim(); if (k && !sceneUrl[k]) sceneUrl[k] = a.url; });

  const PLAYER_NAMES = new Set(["玩家", "主角", "你"]);
  const OVERRIDE_NAMES = new Set(["系統", "？？？", "???", "???"]); // 無立繪、只覆寫名字

  const rows = parseCSV(fs.readFileSync("/tmp/sheet-gid.csv", "utf8"));
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const iStyle = col("style"), iChar = col("character"), iText = col("text"), iScene = col("scene");

  const nodes = [];
  let prevScene = "__init__";
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 2) continue;
    const style = String(row[iStyle] || "").trim();
    const character = String(row[iChar] || "").trim();
    const text = String(row[iText] || "").trim();
    const scene = String(row[iScene] || "").trim();
    if (!style && !text) continue;

    // 背景：換景 + 對得到圖庫 → 設 backgroundUrl（否則沿用）
    let backgroundUrl = null;
    if (scene && scene !== prevScene && sceneUrl[scene]) backgroundUrl = sceneUrl[scene];
    if (scene) prevScene = scene;

    let node;
    if (/^BATTLE/i.test(style)) {
      // 怪物名可能在 character 欄，或 text 的「戰鬥：<名>（標註）」
      let monName = character;
      if (!monIdByName[monName]) monName = text.replace(/^.*?戰鬥[：:]\s*/, "").replace(/（.*$/, "").trim();
      const monId = monIdByName[monName] || null;
      const forced = /必敗/.test(text) ? "lose" : /必勝/.test(text) ? "win" : null;
      node = { type: "battle", monsterId: monId, mustWin: true, forcedOutcome: forced };
    } else if (/^CG/i.test(style)) {
      node = { type: "cg", cgUrl: null, text };
    } else if (/^DIALOGUE/i.test(style) || /對話/.test(style)) {
      let npcId = null, nameOverride = null;
      if (PLAYER_NAMES.has(character)) npcId = "player";
      else if (OVERRIDE_NAMES.has(character) || !npcIdByName[character]) nameOverride = character || null;
      else npcId = npcIdByName[character];
      node = { type: "dialogue", npcId, nameOverride, side: "center", text };
    } else {
      node = { type: "narration", text };
    }
    if (backgroundUrl) node.backgroundUrl = backgroundUrl;
    nodes.push(node);
  }

  // 統計
  const stat = {}; nodes.forEach((n) => stat[n.type] = (stat[n.type] || 0) + 1);
  const battles = nodes.filter((n) => n.type === "battle");
  const unmatchedBattle = battles.filter((n) => !n.monsterId).length;

  const ch = await db.collection("storyChapters").findOne({ id: "chapter-1" });
  // 備份現有章節
  await db.collection("storyChapterBackups").updateOne(
    { _id: "backup-chapter-1-" + Date.now() },
    { $set: { reason: "從Sheet重匯入第一章 前備份", chapterId: "chapter-1", snapshot: ch, createdAt: new Date().toISOString() } },
    { upsert: true }
  );

  const res = await db.collection("storyChapters").updateOne(
    { id: "chapter-1" },
    { $set: { nodes, updatedAt: new Date().toISOString() } }
  );

  console.log("解析節點:", nodes.length, JSON.stringify(stat));
  console.log("戰鬥節點:", battles.length, battles.map((b) => `[怪:${b.monsterId ? "✓" : "✗未對到"} 劇情殺:${b.forcedOutcome || "無"}]`).join(" "));
  if (unmatchedBattle) console.log("⚠️ 有", unmatchedBattle, "個戰鬥節點的怪物沒對到(character 名字與怪物庫不符)");
  console.log("有設背景的節點:", nodes.filter((n) => n.backgroundUrl).length);
  console.log("更新結果 modified:", res.modifiedCount, "（舊章節已備份到 storyChapterBackups）");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
