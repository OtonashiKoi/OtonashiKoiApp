// 匯入「第一章」到主線劇情系統。來源：Google Sheet gid=1121808141 匯出的 /tmp/chapter1.csv。
// 欄位：NB, STYLE(DIALOGUE/MONOLOGUE), character, text, branch, SCENE, ...(演出欄目前空)
// 規則：MONOLOGUE(獨白)→旁白(narration)；DIALOGUE(對話)→對話：
//   玩家→主角(npcId=player,DC名+頭像)、系統→nameOverride「系統」、其餘→對應 NPC 卡。
// 只匯入文字+角色；演出(背景/CG/BGM/立繪)留後台處理。可重跑(章節/NPC 以固定 id upsert)。
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
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 第一章 NPC（固定 id，重跑不重建）。玩家=主角、系統=旁白式覆寫名，不建卡。
const NPC_DEFS = [
  { id: "npc-ch1-passerby-a", name: "路人A", description: "第一章 街頭路人" },
  { id: "npc-ch1-passerby-b", name: "路人B", description: "第一章 街頭路人" },
  { id: "npc-ch1-registrar", name: "報到人員", description: "第一章 冒險者報到處人員" },
  { id: "npc-ch1-examiner", name: "測驗教官", description: "第一章 新手測驗教官" },
  { id: "npc-ch1-student", name: "路人學員", description: "第一章 測驗場其他學員" },
  { id: "npc-ch1-staff", name: "工作人員", description: "第一章 測驗場工作人員" }
];

(async () => {
  const db = await getMongoDb();

  // 1) NPC
  for (const n of NPC_DEFS) {
    await db.collection("storyNpcs").updateOne(
      { id: n.id },
      { $set: { id: n.id, name: n.name, description: n.description, portraitUrl: null, portraitThumbnailUrl: null, expressions: [], updatedAt: new Date().toISOString() }, $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true }
    );
  }
  const npcByName = Object.fromEntries(NPC_DEFS.map((n) => [n.name, n.id]));

  // 2) 解析
  const rows = parseCSV(fs.readFileSync("/tmp/chapter1.csv", "utf8"));
  const header = rows[0];
  const idx = (name) => header.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
  const iStyle = idx("STYLE"), iChar = idx("character"), iText = idx("text"), iScene = idx("SCENE");

  const nodes = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const style = String(row[iStyle] || "");
    const speaker = String(row[iChar] || "").trim();
    const text = String(row[iText] || "").trim();
    const scene = String(row[iScene] || "").trim();
    if (!text || /自動存檔|^~~/.test(text)) continue;

    const isDialogue = /DIALOGUE|對話/i.test(style);
    if (isDialogue) {
      if (speaker === "玩家") {
        nodes.push({ type: "dialogue", npcId: "player", nameOverride: null, side: "center", portraitFx: "", expression: null, text, backgroundUrl: null, bgm: "", sfx: "", sceneTag: scene && scene !== "-" ? scene : null });
      } else {
        const npcId = npcByName[speaker] || null;
        nodes.push({ type: "dialogue", npcId, nameOverride: npcId ? null : (speaker || null), side: "center", portraitFx: "", expression: null, text, backgroundUrl: null, bgm: "", sfx: "", sceneTag: scene && scene !== "-" ? scene : null });
      }
    } else {
      // MONOLOGUE(獨白) 等 → 旁白
      nodes.push({ type: "narration", text, backgroundUrl: null, bgm: "", sfx: "", sceneTag: scene && scene !== "-" ? scene : null });
    }
  }

  // 3) 章節（order 1；序章是 0）。zoneKey 先不綁(不擋任何區)，要綁後台再設。
  const CHAPTER_ID = "chapter-1";
  const existing = await db.collection("storyChapters").findOne({ id: CHAPTER_ID });
  await db.collection("storyChapters").updateOne(
    { id: CHAPTER_ID },
    {
      $set: {
        id: CHAPTER_ID, order: 1, zoneKey: null, title: "第一章", enabled: true, isPrologue: false,
        backgroundUrl: null, scriptDraft: "", nodes, updatedAt: new Date().toISOString()
      },
      $setOnInsert: { createdAt: new Date().toISOString() }
    },
    { upsert: true }
  );

  console.log(`✅ NPC ${NPC_DEFS.length} 個、第一章 ${existing ? "更新" : "新建"}（${nodes.length} 節點）`);
  console.log("節點型別:", `旁白 ${nodes.filter((n) => n.type === "narration").length} / 對話 ${nodes.filter((n) => n.type === "dialogue").length}`);
  const spk = {};
  nodes.filter((n) => n.type === "dialogue").forEach((n) => { const k = n.npcId === "player" ? "玩家(主角)" : (n.nameOverride || n.npcId); spk[k] = (spk[k] || 0) + 1; });
  console.log("對話者分佈:", spk);
  process.exit(0);
})().catch((e) => { console.error("錯誤:", e); process.exit(1); });
