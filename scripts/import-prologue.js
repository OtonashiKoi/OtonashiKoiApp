// 匯入「序章」到主線劇情系統：角色庫→storyNpcs、序章文字→storyChapters(章節+節點)。
// 只匯入「文字+出場角色+場景標記(sceneTag)」；演出(背景/CG/BGM/立繪)留後台處理。
// 來源：/tmp/prologue.csv（Google Sheet gid=0 匯出）。可重跑（章節/ NPC 以固定 id upsert）。
require("dotenv").config();
const fs = require("fs");
const { randomUUID } = require("crypto");
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

// 角色庫（固定 id，方便重跑不重複建）
const NPC_DEFS = [
  { id: "npc-otonashi-koi", name: "音無恋", description: "主要女主角" },
  { id: "npc-otonashi-koi-unknown", name: "音無恋(???)", description: "音無恋（尚未表明身分時的顯示名）" },
  { id: "npc-unknown-adventurer", name: "不明冒險家(???)", description: "序章串場角色" },
  { id: "npc-player-sister", name: "玩家妹妹", description: "序章串場角色" },
  { id: "npc-ikea-koi", name: "IKEA鯉鯉", description: "道具角色" }
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

  // 2) 解析序章
  const rows = parseCSV(fs.readFileSync("/tmp/prologue.csv", "utf8"));
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
      const npcId = npcByName[speaker] || null;
      nodes.push({
        type: "dialogue", text, side: "left", portraitFx: "", expression: null,
        npcId, nameOverride: npcId ? null : (speaker || null),
        backgroundUrl: null, bgm: "", sfx: "", sceneTag: scene || null
      });
    } else {
      nodes.push({ type: "narration", text, backgroundUrl: null, bgm: "", sfx: "", sceneTag: scene || null });
    }
  }

  // 3) 章節（序章：order 0、無區域閘門、標記 isPrologue 供首登顯示）
  const CHAPTER_ID = "chapter-prologue";
  const existing = await db.collection("storyChapters").findOne({ id: CHAPTER_ID });
  await db.collection("storyChapters").updateOne(
    { id: CHAPTER_ID },
    {
      $set: {
        id: CHAPTER_ID, order: 0, zoneKey: null, title: "序章", enabled: true, isPrologue: true,
        backgroundUrl: null, scriptDraft: "", nodes, updatedAt: new Date().toISOString()
      },
      $setOnInsert: { createdAt: new Date().toISOString() }
    },
    { upsert: true }
  );

  // 場景統計（給後台對背景參考）
  const sceneCount = {};
  nodes.forEach((n) => { const s = n.sceneTag || "(無)"; sceneCount[s] = (sceneCount[s] || 0) + 1; });
  console.log(`✅ NPC ${NPC_DEFS.length} 個、序章章節 ${existing ? "更新" : "新建"}（${nodes.length} 節點）`);
  console.log("節點型別:", `旁白 ${nodes.filter((n) => n.type === "narration").length} / 對話 ${nodes.filter((n) => n.type === "dialogue").length}`);
  console.log("場景分布(sceneTag→節點數，後台依此對背景):");
  Object.entries(sceneCount).forEach(([s, c]) => console.log(`  ${s}: ${c}`));
  process.exit(0);
})().catch((e) => { console.error("錯誤:", e); process.exit(1); });
