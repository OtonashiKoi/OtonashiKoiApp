// 主線劇情編輯器（完整劇本工具）
// Phase A：劇本文字模式 / 智慧預設 / 插入·複製·拖曳 / Undo·Redo / 自動草稿 / 搜尋·統計 / 儲存檢查 / 章節複製·匯出入
// 資料流：/admin/story/npcs、/admin/story/chapters、/admin/story/zones、/admin/story/monsters、/admin/story/upload
(function () {
  const root = document.getElementById("story-editor-root");
  if (!root) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 立繪演出動畫（CSS keyframes；預覽用）+ 拖曳視覺
  if (!document.getElementById("story-fx-style")) {
    const s = document.createElement("style");
    s.id = "story-fx-style";
    s.textContent = `
      @keyframes stFxPop { from{opacity:0;transform:scale(.6)} to{opacity:1;transform:scale(1)} }
      @keyframes stFxShake { 0%{opacity:0} 20%{opacity:1;transform:rotate(-4deg)} 40%{transform:rotate(4deg)} 60%{transform:rotate(-3deg)} 80%{transform:rotate(3deg)} 100%{transform:rotate(0)} }
      @keyframes stFxBounce { 0%{opacity:0;transform:translateY(-32px)} 40%{opacity:1;transform:translateY(0)} 70%{transform:translateY(-14px)} 100%{transform:translateY(0)} }
      @keyframes stFxPulse { 0%{opacity:0;transform:scale(.9)} 50%{opacity:1;transform:scale(1.08)} 100%{transform:scale(1)} }
      @keyframes stFxDefault { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      @keyframes stPvFlash { from{opacity:.9} to{opacity:0} }
      @keyframes stPvFade { 0%{opacity:0} 50%{opacity:1} 100%{opacity:0} }
      @keyframes stPvShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-9px)} 40%{transform:translateX(9px)} 60%{transform:translateX(-7px)} 80%{transform:translateX(7px)} }
      .st-node-card.st-drag-over { outline: 2px dashed #7ce0ff; outline-offset: 2px; }
      .st-drag-handle { cursor: grab; user-select: none; color: #6b7399; }
      .st-drag-handle:active { cursor: grabbing; }
    `;
    document.head.appendChild(s);
  }

  // 演出選項（需與前端 sound.ts / story.tsx 一致）
  const BGM_OPTS = [
    ["", "🎵 BGM（不變）"], ["zone", "🗺️ 恢復地圖曲"], ["silence", "🔇 靜音"],
    ["home", "主頁曲"], ["beginner", "新手村"], ["normal", "起始草原"], ["mid", "陽光草原"],
    ["ancient", "古城"], ["ancient_deep", "古城深淵"], ["dragon_realm", "龍族之領"], ["daishi", "大史王"], ["dragon_king", "古龍王"],
    ["push_while_you_can", "🎼 趁能推的時候推"], ["swordsman_village", "🎼 劍士村莊"],
    ["adventure_journey", "🎼 冒險之途"], ["central_city", "🎼 中央主城"]
  ];
  const SFX_OPTS = [
    ["", "🔊 音效（無）"], ["win", "🎉 勝利"], ["crit", "💥 衝擊"], ["lightning", "⚡ 雷"], ["freeze", "❄️ 冰"],
    ["burn", "🔥 火"], ["poison", "☠️ 毒"], ["heal", "💚 治療"], ["block", "🛡️ 格擋"], ["lose", "💀 沉重"],
    ["chest", "🎁 寶箱"], ["item", "✨ 道具"], ["equip", "⚔️ 金屬"]
  ];
  const SIDE_OPTS = [["left", "⬅️ 左"], ["center", "⏺️ 中"], ["right", "➡️ 右"]];
  const FX_OPTS = [
    ["", "立繪演出（預設淡入）"], ["pop", "💥 彈入"], ["shake", "🫨 晃動"],
    ["bounce", "⤴️ 彈跳"], ["pulse", "💗 脈動"], ["dim", "🌑 變暗(背景角色)"]
  ];
  const SCREENFX_OPTS = [["", "🎞️ 畫面效果（無）"], ["shake", "📳 震動"], ["flash", "⚡ 閃白"], ["fadeblack", "🌑 漸黑轉場"]];
  const SPEED_OPTS = [["", "⌨️ 文字速度（普通）"], ["slow", "🐢 慢"], ["normal", "普通"], ["fast", "🐇 快"]];
  const optionsHtml = (opts, sel) => opts.map(([v, l]) => `<option value="${esc(v)}" ${sel === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  const BGM_SRC = {
    home: "/bgm/bgm-home.m4a", beginner: "/bgm/bgm-beginner.m4a", normal: "/bgm/bgm-normal.m4a", mid: "/bgm/bgm-mid.m4a",
    ancient: "/bgm/bgm-ancient.m4a", ancient_deep: "/bgm/bgm-ancient-deep.mp3", dragon_realm: "/bgm/bgm-dragon-realm.mp3",
    daishi: "/bgm/bgm-daishi.mp3", dragon_king: "/bgm/bgm-dragon-king.mp3", push_while_you_can: "/bgm/bgm-push-while-you-can.mp3",
    swordsman_village: "/bgm/bgm-swordsman-village.mp3", adventure_journey: "/bgm/bgm-adventure-journey.mp3", central_city: "/bgm/bgm-central-city.mp3"
  };
  const ZONE_BGM = { beginner: "beginner", normal: "normal", mid: "mid", ancient_city: "ancient", ancient_city_deep: "ancient_deep", dragon_realm: "dragon_realm", elite: "daishi", dragon_king_lair: "dragon_king" };
  const FX_ANIM = { pop: "stFxPop .4s", shake: "stFxShake .5s", bounce: "stFxBounce .6s", pulse: "stFxPulse .5s", dim: "stFxDefault .3s", "": "stFxDefault .3s" };

  function headers(json = true) {
    const h = { Authorization: "Bearer " + (window.elements?.adminPassword?.value?.trim() || "") };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }
  async function fetchJSON(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data?.data ?? data;
  }
  const logMsg = (m) => { try { window.log ? window.log(`[劇情] ${m}`) : console.log(m); } catch (_) { console.log(m); } };

  // ── 狀態 ──
  let npcs = [], zones = [], chapters = [], monsters = [];
  let editing = null;       // 編輯中的章節（working copy）
  let npcForm = null;       // 內嵌 NPC 表單
  const fxOpen = new Set(); // 展開「演出」的節點 index
  let quickOpen = false;    // 快速編寫面板展開
  let undoStack = [], redoStack = [];
  let dragIdx = null;       // 拖曳中的節點 index
  let draftTimer = null;

  async function loadAll() {
    [npcs, zones, chapters, monsters] = await Promise.all([
      fetchJSON("/admin/story/npcs", { headers: headers() }),
      fetchJSON("/admin/story/zones", { headers: headers() }),
      fetchJSON("/admin/story/chapters", { headers: headers() }),
      fetchJSON("/admin/story/monsters", { headers: headers() })
    ]);
    loadAssets().then(() => backfillAssets()); // 劇情圖庫：先載入，再把既有背景/CG 補進圖庫（非阻斷）
    render();
  }
  async function uploadImage(file) {
    const fd = new FormData(); fd.append("image", file);
    return (await fetchJSON("/admin/story/upload", { method: "POST", headers: headers(false), body: fd })).imageUrl;
  }

  // ── 劇情圖庫：上傳一次命名，之後直接選 ──
  let storyAssets = [];
  async function loadAssets() { try { storyAssets = (await fetchJSON("/admin/story/assets")) || []; } catch (_) { storyAssets = []; } }
  async function saveAsset(name, url, kind) {
    if (!url) return null;
    if (storyAssets.some((a) => a.url === url && a.kind === kind)) return null; // 已在圖庫→不重複存
    try { const a = await fetchJSON("/admin/story/assets", { method: "POST", headers: headers(), body: JSON.stringify({ name, url, kind }) }); if (a) storyAssets.unshift(a); return a; } catch (_) { return null; }
  }
  // 上傳存進圖庫（回傳 url）：一律進圖庫，之後其它演出可直接選；命名可留空/取消（用檔名）
  async function uploadNamed(file, kind) {
    const url = await uploadImage(file);
    if (!url) return url;
    const base = (file.name || "").replace(/\.[^.]+$/, "").trim();
    const input = prompt("為這張圖命名（下次可從 📁 圖庫直接選）。留空＝用檔名：", base);
    const name = (input && input.trim()) || base || (kind + "-" + Date.now());
    await saveAsset(name, url, kind); // 即使取消命名也會進圖庫
    return url;
  }
  // 把過去在各節點/章節上傳過、但沒進圖庫的背景/CG 補登進圖庫（讓「別處上傳的背景」在其它演出也選得到）
  async function backfillAssets() {
    try {
      const seen = new Set(storyAssets.map((a) => a.kind + "|" + a.url));
      const nameFromUrl = (u) => { try { const s = decodeURIComponent(String(u).split("?")[0].split("/").pop() || "").replace(/\.[^.]+$/, ""); return s || "背景"; } catch (_) { return "背景"; } };
      const jobs = [];
      const add = (url, kind) => { if (!url) return; const k = kind + "|" + url; if (seen.has(k)) return; seen.add(k); jobs.push(saveAsset(nameFromUrl(url), url, kind)); };
      (chapters || []).forEach((ch) => {
        add(ch.backgroundUrl, "background");
        (ch.nodes || []).forEach((n) => { add(n.backgroundUrl, "background"); add(n.cgUrl, "cg"); });
      });
      if (jobs.length) await Promise.all(jobs);
    } catch (_) {}
  }
  // 圖庫選擇 modal
  function pickAsset(kind, cb) {
    const list = storyAssets.filter((a) => !kind || a.kind === kind);
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:20px;";
    ov.innerHTML = `<div style="background:#141122;border:1px solid #c4a7f5;border-radius:14px;padding:16px;max-width:740px;width:100%;max-height:82vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><b style="color:#c4a7f5;">📁 圖庫 · ${esc(kind)}</b><button class="button" id="pa-close">✕ 關閉</button></div>
      ${list.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;">${list.map((a) => `
        <div class="pa-item" data-pa-url="${esc(a.url)}" style="cursor:pointer;border:1px solid #2a2f45;border-radius:8px;overflow:hidden;position:relative;">
          <img src="${esc(a.url)}" style="width:100%;height:78px;object-fit:cover;display:block;">
          <div style="font-size:11px;padding:4px 6px;color:#cdbce8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.name)}</div>
          <button class="button" data-pa-del="${esc(a.id)}" title="從圖庫刪除" style="position:absolute;top:2px;right:2px;padding:0 5px;font-size:11px;">🗑</button>
        </div>`).join("")}</div>` : '<p class="hint">圖庫還是空的。先在下面「上傳」一張並命名，之後就會出現在這裡。</p>'}
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#pa-close").addEventListener("click", () => ov.remove());
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelectorAll(".pa-item").forEach((el) => el.addEventListener("click", (e) => {
      if (e.target.closest("[data-pa-del]")) return;
      cb(el.dataset.paUrl); ov.remove();
    }));
    ov.querySelectorAll("[data-pa-del]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("從圖庫移除這張？（不影響已用到的節點）")) return;
      await fetchJSON(`/admin/story/assets/${b.dataset.paDel}`, { method: "DELETE", headers: headers() }).catch(() => {});
      storyAssets = storyAssets.filter((a) => a.id !== b.dataset.paDel);
      b.closest(".pa-item")?.remove();
    }));
  }

  // ── Undo / Redo（結構性操作前呼叫 pushUndo）──
  const snap = () => JSON.stringify(editing);
  function pushUndo() { undoStack.push(snap()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
  function doUndo() { if (!undoStack.length || !editing) return; syncEditingFromDom(); redoStack.push(snap()); editing = JSON.parse(undoStack.pop()); render(); }
  function doRedo() { if (!redoStack.length || !editing) return; syncEditingFromDom(); undoStack.push(snap()); editing = JSON.parse(redoStack.pop()); render(); }

  // ── 自動草稿（每 5 秒存 localStorage；儲存/取消時清除）──
  const draftKeyOf = (id) => "storyDraft:" + (id || "new");
  function startDraft() {
    stopDraft();
    draftTimer = setInterval(() => {
      if (!editing) return;
      try { syncEditingFromDom(); localStorage.setItem(draftKeyOf(editing.id), JSON.stringify({ t: Date.now(), data: editing })); } catch (_) {}
    }, 5000);
  }
  function stopDraft() { if (draftTimer) clearInterval(draftTimer); draftTimer = null; }
  function clearDraft() { try { localStorage.removeItem(draftKeyOf(editing?.id)); } catch (_) {} }
  function maybeRestoreDraft(id) {
    try {
      const raw = localStorage.getItem(draftKeyOf(id));
      if (!raw) return null;
      const d = JSON.parse(raw);
      const when = new Date(d.t).toLocaleString("zh-TW", { hour12: false });
      if (confirm(`發現未儲存的草稿（${when}），要還原嗎？\n（取消＝丟棄草稿、載入已儲存版本）`)) return d.data;
      localStorage.removeItem(draftKeyOf(id));
    } catch (_) {}
    return null;
  }

  // ── 劇本文字解析 ──
  // 規則：`名字：台詞`→對話（自動比對人物卡）；`⚔️怪物名`→戰鬥；`＊`開頭強制旁白；其餘→旁白
  function parseScript(text) {
    const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const out = []; const unknownNpc = new Set(); const unknownMon = new Set();
    let lastNpcId = null;
    for (const line of lines) {
      if (/^[⚔️⚔]/u.test(line)) {
        const name = line.replace(/^[⚔️⚔\s]+/u, "").trim();
        const m = monsters.find((x) => x.name === name) || monsters.find((x) => name && x.name.includes(name));
        if (!m) unknownMon.add(name || "(未填)");
        out.push({ type: "battle", monsterId: m?.id || null, mustWin: true, backgroundUrl: null, bgm: "", sfx: "" });
        continue;
      }
      if (line.startsWith("＊") || line.startsWith("*")) {
        out.push({ type: "narration", text: line.slice(1).trim(), backgroundUrl: null, bgm: "", sfx: "" });
        continue;
      }
      // 名字：？/? 允許（神秘角色 ？？？），但排除句末標點 。！，、避免整句被誤判成 名字：台詞
      const mm = line.match(/^([^：:。！，、\s]{1,12})[：:]\s*(.+)$/);
      if (mm) {
        const name = mm[1].trim(); const speech = mm[2].trim();
        const npc = npcs.find((x) => x.name === name);
        if (!npc) unknownNpc.add(name);
        if (npc) lastNpcId = npc.id;
        out.push({ type: "dialogue", npcId: npc?.id || null, nameOverride: npc ? null : name, side: "left", portraitFx: "", text: speech, backgroundUrl: null, bgm: "", sfx: "" });
        continue;
      }
      out.push({ type: "narration", text: line, backgroundUrl: null, bgm: "", sfx: "" });
    }
    void lastNpcId;
    return { nodes: out, unknownNpc: [...unknownNpc], unknownMon: [...unknownMon] };
  }

  // ── 智慧預設：上一位說話者 / 最近使用 NPC ──
  function lastSpeakerNpcId() {
    for (let i = (editing?.nodes?.length || 0) - 1; i >= 0; i--) {
      const n = editing.nodes[i];
      if (n.type === "dialogue" && n.npcId) return n.npcId;
    }
    return recentNpcIds()[0] || npcs[0]?.id || null;
  }
  function recentNpcIds() {
    try { return JSON.parse(localStorage.getItem("storyRecentNpcs") || "[]"); } catch (_) { return []; }
  }
  function bumpRecentNpcs(ids) {
    try {
      const cur = recentNpcIds().filter((x) => !ids.includes(x));
      localStorage.setItem("storyRecentNpcs", JSON.stringify([...ids, ...cur].slice(0, 10)));
    } catch (_) {}
  }
  function orderedNpcs() {
    const rec = recentNpcIds();
    return [...npcs].sort((a, b) => {
      const ra = rec.indexOf(a.id), rb = rec.indexOf(b.id);
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
  }

  // ── NPC ──
  async function saveNpcForm() {
    if (!npcForm?.name?.trim()) { alert("請填 NPC 名字"); return; }
    await fetchJSON("/admin/story/npcs", { method: "POST", headers: headers(), body: JSON.stringify(npcForm) });
    logMsg(`NPC「${npcForm.name}」已儲存`); npcForm = null; await loadAll();
  }
  async function deleteNpc(id, name) {
    if (!confirm(`刪除 NPC「${name}」？引用它的對話會顯示 ???`)) return;
    await fetchJSON(`/admin/story/npcs/${id}`, { method: "DELETE", headers: headers() });
    logMsg(`NPC「${name}」已刪除`); await loadAll();
  }
  async function uploadPortrait(id, file) {
    const fd = new FormData(); fd.append("image", file);
    await fetchJSON(`/admin/story/npcs/${id}/portrait`, { method: "POST", headers: headers(false), body: fd });
    logMsg("立繪已上傳"); await loadAll();
  }

  // ── 儲存前檢查 ──
  function validateChapter() {
    const errors = [], warns = [];
    (editing.nodes || []).forEach((n, i) => {
      if (n.type === "battle") {
        if (!n.monsterId || !monsters.find((m) => m.id === n.monsterId)) errors.push(`#${i + 1} 戰鬥節點未指定有效怪物`);
      } else {
        if (!String(n.text || "").trim()) warns.push(`#${i + 1} ${n.type === "dialogue" ? "對話" : "旁白"}內容是空的`);
        if (n.type === "dialogue" && n.npcId && !npcs.find((x) => x.id === n.npcId)) warns.push(`#${i + 1} 對話的 NPC 已不存在（會顯示 ???）`);
        if (n.type === "dialogue" && !n.npcId && !n.nameOverride) warns.push(`#${i + 1} 對話沒有選 NPC 也沒有名字覆寫（會顯示 ???）`);
      }
    });
    return { errors, warns };
  }

  // ── 章節 ──
  async function saveChapter() {
    if (!editing) return;
    const { errors, warns } = validateChapter();
    if (errors.length) { alert("儲存被擋下，請先修正：\n" + errors.join("\n")); return; }
    if (warns.length && !confirm("有些小提醒：\n" + warns.join("\n") + "\n\n仍要儲存嗎？")) return;
    const saved = await fetchJSON("/admin/story/chapters", { method: "POST", headers: headers(), body: JSON.stringify(editing) });
    bumpRecentNpcs([...new Set((editing.nodes || []).filter((n) => n.npcId).map((n) => n.npcId))]);
    logMsg(`章節「${saved.title}」已儲存（${saved.nodes.length} 節點）`);
    clearDraft(); stopDraft(); editing = null; fxOpen.clear(); undoStack = []; redoStack = [];
    await loadAll();
  }
  async function deleteChapter(id, title) {
    if (!confirm(`刪除章節「${title}」？綁定區域的閘門會解除。`)) return;
    await fetchJSON(`/admin/story/chapters/${id}`, { method: "DELETE", headers: headers() });
    logMsg(`章節「${title}」已刪除`); await loadAll();
  }
  async function duplicateChapter(id) {
    const c = chapters.find((x) => x.id === id);
    if (!c) return;
    const copy = JSON.parse(JSON.stringify(c));
    delete copy.id; delete copy._id; delete copy.createdAt; delete copy.updatedAt;
    copy.title = `${c.title}（複製）`;
    copy.order = chapters.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0) + 1;
    copy.enabled = false; // 複製品預設停用，避免立即生效
    await fetchJSON("/admin/story/chapters", { method: "POST", headers: headers(), body: JSON.stringify(copy) });
    logMsg(`已複製章節「${c.title}」（停用中）`); await loadAll();
  }
  function exportChapter(id) {
    const c = chapters.find((x) => x.id === id);
    if (!c) return;
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `story-chapter-${(c.title || "chapter").replace(/[^\w一-鿿-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function importChapterFile(file) {
    try {
      const raw = JSON.parse(await file.text());
      const copy = { ...raw };
      delete copy.id; delete copy._id; delete copy.createdAt; delete copy.updatedAt;
      copy.title = `${copy.title || "匯入章節"}（匯入）`;
      copy.order = chapters.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0) + 1;
      copy.enabled = false;
      await fetchJSON("/admin/story/chapters", { method: "POST", headers: headers(), body: JSON.stringify(copy) });
      logMsg(`已匯入章節「${copy.title}」（停用中）`); await loadAll();
    } catch (e) { alert("匯入失敗：" + e.message); }
  }

  // ── 統計 ──
  function chapterStats() {
    const nodes = editing?.nodes || [];
    const chars = nodes.reduce((s, n) => s + String(n.text || "").length, 0);
    const battles = nodes.filter((n) => n.type === "battle").length;
    const secs = Math.round(chars * 0.028 + nodes.length * 1.2 + battles * 25);
    const m = Math.floor(secs / 60), s2 = secs % 60;
    return `${nodes.length} 節點・${chars} 字・約 ${m ? m + "分" : ""}${s2}秒${battles ? `・⚔️×${battles}` : ""}`;
  }

  // ── 樣式常數 ──
  const BOX = "border:1px solid #2c3350;border-radius:10px;padding:12px;margin-bottom:12px;background:rgba(20,24,44,0.5);";
  const ROW = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;";
  const zoneName = (k) => zones.find((z) => z.key === k)?.label || k || "(未綁定)";

  function render() {
    root.innerHTML = editing ? renderChapterEditor() : renderLists();
    bind();
  }

  // ── 目錄畫面 ──
  function renderLists() {
    const npcRows = npcs.map((n) => `
      <div style="${ROW}border-bottom:1px dashed #2c3350;padding-bottom:8px;">
        ${n.portraitUrl ? `<img src="${esc(n.portraitUrl)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">` : `<div style="width:44px;height:44px;border-radius:8px;background:#232945;display:flex;align-items:center;justify-content:center;">🎭</div>`}
        <div style="flex:1;min-width:120px;">
          <div><b>${esc(n.name)}</b></div>
          <div class="hint" style="margin:0;">${esc(n.description || "")}</div>
        </div>
        <label class="button" style="cursor:pointer;">🖼 立繪<input type="file" accept="image/*" data-npc-portrait="${esc(n.id)}" style="display:none;"></label>
        <button class="button" data-npc-edit="${esc(n.id)}">✏️</button>
        <button class="button" data-npc-del="${esc(n.id)}" data-npc-name="${esc(n.name)}">🗑</button>
      </div>`).join("");

    const exprRows = (npcForm?.expressions || []).map((e, i) => `
      <div style="${ROW}margin-bottom:4px;">
        ${e.url ? `<img src="${esc(e.url)}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">` : `<div style="width:36px;height:36px;border-radius:6px;background:#232945;display:flex;align-items:center;justify-content:center;">😊</div>`}
        <input type="text" data-expr-name="${i}" placeholder="表情名(如:開心/生氣)" value="${esc(e.name || "")}" style="width:150px;">
        <label class="button" style="cursor:pointer;">🖼 圖<input type="file" accept="image/*" data-expr-file="${i}" style="display:none;"></label>
        <button class="button" data-expr-del="${i}">🗑</button>
      </div>`).join("");
    const npcFormHtml = npcForm ? `
      <div style="${BOX}background:rgba(40,44,74,0.6);margin-top:8px;">
        <div style="${ROW}"><b>${npcForm.id ? "✏️ 編輯 NPC 人物卡" : "➕ 新增 NPC 人物卡"}</b></div>
        <div style="${ROW}">
          <input type="text" id="npc-form-name" placeholder="NPC 名字" value="${esc(npcForm.name || "")}" style="width:180px;">
          <input type="text" id="npc-form-desc" placeholder="描述（選填）" value="${esc(npcForm.description || "")}" style="flex:1;min-width:180px;">
        </div>
        <div style="${ROW}">
          <span class="hint" style="margin:0;">預設立繪：</span>
          ${npcForm.portraitUrl ? `<img src="${esc(npcForm.portraitUrl)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">` : `<div style="width:44px;height:44px;border-radius:8px;background:#232945;display:flex;align-items:center;justify-content:center;">🎭</div>`}
          <label class="button" style="cursor:pointer;">🖼 上傳<input type="file" accept="image/*" id="npc-form-portrait" style="display:none;"></label>
        </div>
        <div style="border-top:1px dashed #2c3350;margin-top:6px;padding-top:6px;">
          <div style="${ROW}justify-content:space-between;"><span class="hint" style="margin:0;">😊 表情差分（對話節點可選；名字對應下拉）</span><button class="button" id="npc-form-add-expr">➕ 加表情</button></div>
          ${exprRows || '<p class="hint" style="margin:2px 0;">尚無表情差分。加了之後，對話節點的「表情」下拉就能選。</p>'}
        </div>
        <div style="${ROW}margin-top:8px;margin-bottom:0;">
          <button class="button primary" id="npc-form-save">💾 儲存</button>
          <button class="button" id="npc-form-cancel">取消</button>
        </div>
      </div>` : "";

    const chRows = chapters.map((c) => `
      <div style="${ROW}border-bottom:1px dashed #2c3350;padding-bottom:8px;">
        <span style="font-size:18px;">${c.enabled !== false ? "🟢" : "⚪"}</span>
        <div style="flex:1;min-width:160px;">
          <div><b>第 ${Number(c.order) || 0} 章・${esc(c.title)}</b></div>
          <div class="hint" style="margin:0;">📍 ${esc(zoneName(c.zoneKey))}　節點 ${(c.nodes || []).length}</div>
        </div>
        <button class="button" data-ch-edit="${esc(c.id)}">✏️ 編輯</button>
        <button class="button" data-ch-dup="${esc(c.id)}" title="複製整章（停用中）">⿻</button>
        <button class="button" data-ch-export="${esc(c.id)}" title="匯出 JSON 備份">⬇️</button>
        <button class="button" data-ch-del="${esc(c.id)}" data-ch-title="${esc(c.title)}">🗑</button>
      </div>`).join("");

    return `
      <div style="${BOX}">
        <div style="${ROW}justify-content:space-between;">
          <h3 style="margin:0;">🎭 NPC 人物卡（${npcs.length}）</h3>
          <button class="button primary" id="story-npc-add">➕ 新增 NPC</button>
        </div>
        <p class="hint">做一次人物卡（名字＋立繪），寫對話時選了就自動出立繪＋名字。</p>
        ${npcRows || '<p class="hint">尚無 NPC。</p>'}
        ${npcFormHtml}
      </div>
      <div style="${BOX}">
        <div style="${ROW}justify-content:space-between;">
          <h3 style="margin:0;">📖 章節清單（${chapters.length}）</h3>
          <div style="display:flex;gap:8px;">
            <label class="button" style="cursor:pointer;">📥 匯入<input type="file" accept="application/json" id="story-ch-import" style="display:none;"></label>
            <button class="button primary" id="story-ch-add">➕ 新增章節</button>
          </div>
        </div>
        <p class="hint">章節依「順序」一章一章解鎖；綁地圖後，玩家沒看完該章就不能在該地圖行動。⿻複製與📥匯入的章節會以「停用」建立。</p>
        ${chRows || '<p class="hint">尚無章節。</p>'}
      </div>`;
  }

  // ── 章節編輯器 ──
  function renderChapterEditor() {
    const zoneOpts = ['<option value="">（不綁定地圖：純劇情章）</option>']
      .concat(zones.map((z) => `<option value="${esc(z.key)}" ${editing.zoneKey === z.key ? "selected" : ""}>${esc(z.label)}（${esc(z.key)}）</option>`)).join("");
    const npcOpts = (sel) => ['<option value="">（選 NPC）</option>', `<option value="player" ${sel === "player" ? "selected" : ""}>🧑 玩家（主角，登入者DC名+頭像）</option>`]
      .concat(orderedNpcs().map((n) => `<option value="${esc(n.id)}" ${sel === n.id ? "selected" : ""}>${esc(n.name)}</option>`)).join("");
    const monsterOpts = (sel) => ['<option value="">（選怪物）</option>']
      .concat(monsters.map((m) => `<option value="${esc(m.id)}" ${sel === m.id ? "selected" : ""}>${m.isBoss ? "👑 " : ""}${esc(m.name)}（${esc(m.zone || "?")} Lv${m.level ?? "?"}）</option>`)).join("");
    const typeBtn = (i, t, cur, label) => `<button type="button" class="button ${cur === t ? "primary" : ""}" data-node-settype="${i}" data-settype="${t}" style="padding:3px 10px;">${label}</button>`;

    // 某 NPC 的表情下拉（預設 + 各表情名）
    const exprOpts = (npcId, sel) => {
      const npc = npcs.find((x) => x.id === npcId);
      const exprs = Array.isArray(npc?.expressions) ? npc.expressions : [];
      return ['<option value="">（預設立繪）</option>']
        .concat(exprs.map((e) => `<option value="${esc(e.name)}" ${sel === e.name ? "selected" : ""}>😊 ${esc(e.name)}</option>`)).join("");
    };
    const nodeRows = (editing.nodes || []).map((n, i) => {
      const isBattle = n.type === "battle", isDlg = n.type === "dialogue", isCG = n.type === "cg";
      const showFx = fxOpen.has(i);
      const mainArea = isBattle
        ? `<div style="${ROW}">
             <select data-node="${i}" data-field="monsterId" style="min-width:220px;">${monsterOpts(n.monsterId)}</select>
             <label style="font-size:12px;"><input type="checkbox" data-node="${i}" data-field="mustWin" ${n.mustWin !== false ? "checked" : ""}> 必須打贏才能過</label>
           </div>`
        : isCG
          ? `<div style="${ROW}margin-bottom:4px;">
               <label class="button" style="cursor:pointer;">🖼 CG 事件圖<input type="file" accept="image/*" data-node-cg="${i}" style="display:none;"></label>
               <button class="button" data-node-cg-pick="${i}" title="從圖庫選">📁 圖庫</button>
               ${n.cgUrl ? `<img src="${esc(n.cgUrl)}" style="height:44px;border-radius:6px;"><button class="button" data-node-cg-clear="${i}">✖</button>` : '<span class="hint" style="margin:0;color:#ff9a8f;">尚未上傳 CG 圖</span>'}
             </div>
             <textarea data-node="${i}" data-field="text" rows="2" style="width:100%;box-sizing:border-box;" placeholder="CG 字幕（選填，留空＝純圖）">${esc(n.text || "")}</textarea>`
        : isDlg
          ? `<div style="${ROW}margin-bottom:4px;"><select data-node="${i}" data-field="npcId" style="min-width:140px;">${npcOpts(n.npcId)}</select>
               <select data-node="${i}" data-field="expression" title="表情差分" style="min-width:110px;">${exprOpts(n.npcId, n.expression)}</select>
               <input type="text" data-node="${i}" data-field="nameOverride" placeholder="名字覆寫(選填)" value="${esc(n.nameOverride || "")}" style="width:120px;"></div>
             <textarea data-node="${i}" data-field="text" rows="2" style="width:100%;box-sizing:border-box;" placeholder="角色台詞…（Ctrl+Enter＝下方接一句同角色）">${esc(n.text || "")}</textarea>`
          : `<textarea data-node="${i}" data-field="text" rows="2" style="width:100%;box-sizing:border-box;" placeholder="旁白敘述…（Ctrl+Enter＝下方接一句旁白）">${esc(n.text || "")}</textarea>`;
      const fxPanel = showFx ? `
        <div style="border-top:1px dashed #2c3350;margin-top:8px;padding-top:8px;">
          ${isDlg ? `<div style="${ROW}margin-bottom:6px;">
            <span class="hint" style="margin:0;">🎭 立繪：</span>
            <select data-node="${i}" data-field="side">${optionsHtml(SIDE_OPTS, n.side || "left")}</select>
            <select data-node="${i}" data-field="portraitFx">${optionsHtml(FX_OPTS, n.portraitFx || "")}</select>
          </div>` : ""}
          <div style="${ROW}margin-bottom:6px;">
            <label class="button" style="cursor:pointer;">🏞 背景<input type="file" accept="image/*" data-node-bg="${i}" style="display:none;"></label>
            <button class="button" data-node-bg-pick="${i}" title="從圖庫選">📁 圖庫</button>
            ${n.backgroundUrl ? `<img src="${esc(n.backgroundUrl)}" style="height:30px;border-radius:6px;"><button class="button" data-node-bg-clear="${i}">✖</button>` : '<span class="hint" style="margin:0;">未設＝沿用前景</span>'}
            <span style="flex:1;"></span>
            <select data-node="${i}" data-field="bgm">${optionsHtml(BGM_OPTS, n.bgm || "")}</select>
            <select data-node="${i}" data-field="sfx">${optionsHtml(SFX_OPTS, n.sfx || "")}</select>
          </div>
          <div style="${ROW}margin-bottom:0;">
            <select data-node="${i}" data-field="screenFx">${optionsHtml(SCREENFX_OPTS, n.screenFx || "")}</select>
            <select data-node="${i}" data-field="textSpeed">${optionsHtml(SPEED_OPTS, n.textSpeed || "")}</select>
            <label style="font-size:12px;" title="進場前清掉台上其他立繪(換場/獨白用)"><input type="checkbox" data-node="${i}" data-field="clearStage" ${n.clearStage ? "checked" : ""}> 🧹 清空其他立繪</label>
          </div>
        </div>` : "";
      const fxHint = [n.backgroundUrl && "🏞", (n.bgm && n.bgm !== "") && "🎵", (n.sfx && n.sfx !== "") && "🔊", (isDlg && n.portraitFx) && "🎭", (n.screenFx && n.screenFx !== "") && "🎞️", n.clearStage && "🧹"].filter(Boolean).join(" ");

      return `
      <div class="st-node-card" data-node-card="${i}" style="${BOX}background:rgba(28,32,56,0.6);">
        <div style="${ROW}margin-bottom:6px;">
          <span class="st-drag-handle" draggable="true" data-drag="${i}" title="拖曳排序">⠿</span>
          <b style="color:#8b93b8;">#${i + 1}</b>
          ${typeBtn(i, "narration", n.type === "narration" || !n.type, "旁白")}
          ${typeBtn(i, "dialogue", n.type === "dialogue", "💬 對話")}
          ${typeBtn(i, "battle", n.type === "battle", "⚔️ 戰鬥")}
          ${typeBtn(i, "cg", n.type === "cg", "🖼 CG")}
          <span style="flex:1;"></span>
          <button class="button ${showFx ? "primary" : ""}" data-node-fx="${i}" style="padding:3px 8px;">🎬 演出${fxHint ? " " + fxHint : ""}</button>
          <button class="button" data-node-insert="${i}" style="padding:3px 8px;" title="下方插入同型節點">⤵</button>
          <button class="button" data-node-dup="${i}" style="padding:3px 8px;" title="複製此節點(含演出)">⿻</button>
          <button class="button" data-node-up="${i}" ${i === 0 ? "disabled" : ""} style="padding:3px 8px;">↑</button>
          <button class="button" data-node-down="${i}" ${i === (editing.nodes.length - 1) ? "disabled" : ""} style="padding:3px 8px;">↓</button>
          <button class="button" data-node-del="${i}" style="padding:3px 8px;">🗑</button>
        </div>
        ${isBattle ? `<div class="hint" style="margin:0 0 6px;">⚔️ 玩家讀到此需擊敗指定怪${n.mustWin !== false ? "（必勝、SKIP 不可繞）" : "（戰敗也可續）"}</div>` : ""}
        ${mainArea}
        ${fxPanel}
      </div>`;
    }).join("");

    return `
      <div style="${BOX}position:sticky;top:0;z-index:10;">
        <div style="${ROW}justify-content:space-between;">
          <h3 style="margin:0;">${editing.id ? "✏️ 編輯章節" : "➕ 新增章節"}</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="button" id="story-undo" ${undoStack.length ? "" : "disabled"} title="復原">↩️</button>
            <button class="button" id="story-redo" ${redoStack.length ? "" : "disabled"} title="重做">↪️</button>
            <button class="button" id="story-ch-preview">▶ 本章預覽</button>
            <button class="button" id="story-ch-cancel">取消</button>
            <button class="button primary" id="story-ch-save">💾 儲存章節</button>
          </div>
        </div>
        <div style="${ROW}">
          <label>順序 <input type="number" id="story-f-order" value="${Number(editing.order) || 0}" style="width:64px;"></label>
          <label>標題 <input type="text" id="story-f-title" value="${esc(editing.title || "")}" style="width:200px;" placeholder="例：草原的呼喚"></label>
          <label>地圖 <select id="story-f-zone">${zoneOpts}</select></label>
          <label><input type="checkbox" id="story-f-enabled" ${editing.enabled !== false ? "checked" : ""}> 啟用</label>
          <label class="button" style="cursor:pointer;">🖼 章節背景<input type="file" accept="image/*" id="story-f-bg" style="display:none;"></label>
          <button class="button" id="story-f-bg-pick" title="從圖庫選">📁 圖庫</button>
          ${editing.backgroundUrl ? `<img src="${esc(editing.backgroundUrl)}" style="height:32px;border-radius:6px;"><button class="button" id="story-f-bg-clear">✖</button>` : '<span class="hint" style="margin:0;">未設＝用地圖背景</span>'}
        </div>
        <div style="${ROW}margin-bottom:0;">
          <input type="search" id="story-search" placeholder="🔍 搜尋台詞…" style="width:180px;">
          <span class="hint" style="margin:0;">📊 ${chapterStats()}</span>
        </div>
      </div>

      <div style="${BOX}">
        <button class="button ${quickOpen ? "primary" : ""}" id="story-quick-toggle">✍️ 快速編寫（劇本模式）${quickOpen ? "▲" : "▼"}${(editing.scriptDraft || "").trim() ? " 📝有草稿" : ""}</button>
        ${quickOpen ? `
        <div style="margin-top:8px;">
          <p class="hint" style="margin:0 0 6px;">一行一句：「<b>名字：台詞</b>」＝對話（自動比對人物卡）；「<b>⚔️怪物名</b>」＝戰鬥；其他行＝旁白（行首加「＊」可強制旁白）。可先「暫存草稿」慢慢寫，確認後再「解析並加入」。</p>
          <textarea id="story-quick-text" rows="10" style="width:100%;box-sizing:border-box;" placeholder="米拉桑：歡迎來到音無樂園！&#10;風吹過草原。&#10;⚔️大史(B)&#10;米拉桑：幹得好，冒險者。">${esc(editing.scriptDraft || "")}</textarea>
          <div style="${ROW}margin-top:6px;margin-bottom:0;">
            <button class="button" id="story-quick-savedraft">💾 暫存草稿（不解析）</button>
            <button class="button primary" id="story-quick-parse">📜 解析並加入</button>
            <span class="hint" id="story-quick-result" style="margin:0;"></span>
          </div>
        </div>` : ""}
      </div>

      <div style="${BOX}">
        <div style="${ROW}justify-content:space-between;">
          <h3 style="margin:0;">節點（${(editing.nodes || []).length}）— 由上到下播放</h3>
          <div style="display:flex;gap:8px;">
            <button class="button" id="story-node-add-narration">➕ 旁白</button>
            <button class="button" id="story-node-add-dialogue">➕ 💬 對話</button>
            <button class="button" id="story-node-add-battle">➕ ⚔️ 戰鬥</button>
            <button class="button" id="story-node-add-cg">➕ 🖼 CG</button>
          </div>
        </div>
        ${nodeRows || '<p class="hint">還沒有節點。用上面「✍️ 快速編寫」一次貼整段，或按 ➕ 加一句。</p>'}
      </div>`;
  }

  // 讀回 DOM 欄位（re-render 前呼叫）
  function syncEditingFromDom() {
    if (!editing) return;
    const g = (id) => document.getElementById(id);
    if (g("story-f-order")) editing.order = Number(g("story-f-order").value) || 0;
    if (g("story-f-title")) editing.title = g("story-f-title").value;
    if (g("story-f-zone")) editing.zoneKey = g("story-f-zone").value || null;
    if (g("story-f-enabled")) editing.enabled = g("story-f-enabled").checked;
    if (g("story-quick-text")) editing.scriptDraft = g("story-quick-text").value; // 快速編寫原始草稿(隨章節存)
    root.querySelectorAll("[data-node][data-field]").forEach((el) => {
      const i = Number(el.dataset.node), f = el.dataset.field;
      if (!editing.nodes[i]) return;
      editing.nodes[i][f] = el.type === "checkbox" ? el.checked : el.value;
    });
  }

  // 開啟章節編輯（含草稿還原）
  function openEditor(base) {
    const restored = maybeRestoreDraft(base.id);
    editing = restored || base;
    fxOpen.clear(); undoStack = []; redoStack = []; quickOpen = !(editing.nodes || []).length; // 空章自動展開快速編寫
    render(); startDraft();
  }

  function bind() {
    // ── NPC ──
    root.querySelector("#story-npc-add")?.addEventListener("click", () => { npcForm = { name: "", description: "", portraitUrl: null, expressions: [] }; render(); });
    root.querySelectorAll("[data-npc-edit]").forEach((b) => b.addEventListener("click", () => {
      const n = npcs.find((x) => x.id === b.dataset.npcEdit);
      npcForm = { id: n.id, name: n.name, description: n.description || "", portraitUrl: n.portraitUrl || null, expressions: Array.isArray(n.expressions) ? JSON.parse(JSON.stringify(n.expressions)) : [] };
      render();
    }));
    root.querySelectorAll("[data-npc-del]").forEach((b) => b.addEventListener("click", () => deleteNpc(b.dataset.npcDel, b.dataset.npcName)));
    root.querySelectorAll("[data-npc-portrait]").forEach((inp) => inp.addEventListener("change", async () => { if (inp.files?.[0]) await uploadPortrait(inp.dataset.npcPortrait, inp.files[0]); }));
    if (npcForm) {
      const syncNpcForm = () => {
        const nn = root.querySelector("#npc-form-name"), nd = root.querySelector("#npc-form-desc");
        if (nn) npcForm.name = nn.value;
        if (nd) npcForm.description = nd.value;
        root.querySelectorAll("[data-expr-name]").forEach((el) => { const i = Number(el.dataset.exprName); if (npcForm.expressions[i]) npcForm.expressions[i].name = el.value; });
      };
      root.querySelector("#npc-form-name")?.addEventListener("input", (e) => { npcForm.name = e.target.value; });
      root.querySelector("#npc-form-desc")?.addEventListener("input", (e) => { npcForm.description = e.target.value; });
      root.querySelectorAll("[data-expr-name]").forEach((el) => el.addEventListener("input", () => { const i = Number(el.dataset.exprName); if (npcForm.expressions[i]) npcForm.expressions[i].name = el.value; }));
      root.querySelector("#npc-form-portrait")?.addEventListener("change", async (e) => { if (!e.target.files?.[0]) return; syncNpcForm(); npcForm.portraitUrl = await uploadImage(e.target.files[0]); render(); });
      root.querySelector("#npc-form-add-expr")?.addEventListener("click", () => { syncNpcForm(); npcForm.expressions.push({ name: "", url: null }); render(); });
      root.querySelectorAll("[data-expr-file]").forEach((inp) => inp.addEventListener("change", async () => { if (!inp.files?.[0]) return; syncNpcForm(); npcForm.expressions[Number(inp.dataset.exprFile)].url = await uploadImage(inp.files[0]); render(); }));
      root.querySelectorAll("[data-expr-del]").forEach((b) => b.addEventListener("click", () => { syncNpcForm(); npcForm.expressions.splice(Number(b.dataset.exprDel), 1); render(); }));
      root.querySelector("#npc-form-save")?.addEventListener("click", () => { syncNpcForm(); npcForm.expressions = npcForm.expressions.filter((e) => e.name && e.url); saveNpcForm().catch((err) => alert("儲存失敗：" + err.message)); });
      root.querySelector("#npc-form-cancel")?.addEventListener("click", () => { npcForm = null; render(); });
    }

    // ── 章節目錄 ──
    root.querySelector("#story-ch-add")?.addEventListener("click", () => {
      const maxOrder = chapters.reduce((m, c) => Math.max(m, Number(c.order) || 0), 0);
      openEditor({ order: maxOrder + 1, title: "", zoneKey: null, enabled: true, backgroundUrl: null, nodes: [], scriptDraft: "" });
    });
    root.querySelectorAll("[data-ch-edit]").forEach((b) => b.addEventListener("click", () => {
      const c = chapters.find((x) => x.id === b.dataset.chEdit);
      openEditor(JSON.parse(JSON.stringify({ id: c.id, order: c.order, title: c.title, zoneKey: c.zoneKey, enabled: c.enabled !== false, backgroundUrl: c.backgroundUrl || null, nodes: c.nodes || [], scriptDraft: c.scriptDraft || "" })));
    }));
    root.querySelectorAll("[data-ch-del]").forEach((b) => b.addEventListener("click", () => deleteChapter(b.dataset.chDel, b.dataset.chTitle)));
    root.querySelectorAll("[data-ch-dup]").forEach((b) => b.addEventListener("click", () => duplicateChapter(b.dataset.chDup).catch((e) => alert("複製失敗：" + e.message))));
    root.querySelectorAll("[data-ch-export]").forEach((b) => b.addEventListener("click", () => exportChapter(b.dataset.chExport)));
    root.querySelector("#story-ch-import")?.addEventListener("change", (e) => { if (e.target.files?.[0]) importChapterFile(e.target.files[0]); });

    if (!editing) return;

    // ── 編輯器頂列 ──
    root.querySelector("#story-undo")?.addEventListener("click", doUndo);
    root.querySelector("#story-redo")?.addEventListener("click", doRedo);
    root.querySelector("#story-ch-save")?.addEventListener("click", async () => {
      // 保險：快速編寫框還有沒解析的文字 → 自動解析加入，避免辛苦打的內容白費
      const qta = root.querySelector("#story-quick-text");
      if (qta && qta.value.trim()) {
        const { nodes } = parseScript(qta.value);
        if (nodes.length && confirm(`「快速編寫」框裡還有 ${nodes.length} 段沒按解析。要一起加入再儲存嗎？\n（取消＝只存目前的節點，快速框內容會保留在框裡）`)) {
          syncEditingFromDom(); pushUndo();
          editing.nodes.push(...nodes); qta.value = ""; render();
        }
      }
      syncEditingFromDom();
      if (!editing.title?.trim()) { alert("請輸入章節標題"); return; }
      try { await saveChapter(); } catch (e) { alert("儲存失敗：" + e.message); }
    });
    root.querySelector("#story-ch-cancel")?.addEventListener("click", () => {
      if (!confirm("放棄未儲存的變更？（自動草稿也會一併刪除）")) return;
      clearDraft(); stopDraft(); editing = null; fxOpen.clear(); undoStack = []; redoStack = []; render();
    });
    root.querySelector("#story-ch-preview")?.addEventListener("click", () => { syncEditingFromDom(); openPreview(); });
    root.querySelector("#story-f-bg")?.addEventListener("change", async (e) => { if (!e.target.files?.[0]) return; syncEditingFromDom(); pushUndo(); editing.backgroundUrl = await uploadNamed(e.target.files[0], "background"); render(); });
    root.querySelector("#story-f-bg-pick")?.addEventListener("click", () => pickAsset("background", (url) => { syncEditingFromDom(); pushUndo(); editing.backgroundUrl = url; render(); }));
    root.querySelector("#story-f-bg-clear")?.addEventListener("click", () => { syncEditingFromDom(); pushUndo(); editing.backgroundUrl = null; render(); });

    // 搜尋：直接過濾 DOM，不 re-render（保留輸入焦點）
    root.querySelector("#story-search")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      root.querySelectorAll("[data-node-card]").forEach((card) => {
        if (!q) { card.style.display = ""; return; }
        const i = Number(card.dataset.nodeCard);
        const n = editing.nodes[i] || {};
        const ta = card.querySelector("textarea");
        const txt = ((ta ? ta.value : n.text) || "") + (n.nameOverride || "") + ((npcs.find((x) => x.id === n.npcId) || {}).name || "");
        card.style.display = txt.toLowerCase().includes(q) ? "" : "none";
      });
    });

    // 快速編寫
    root.querySelector("#story-quick-toggle")?.addEventListener("click", () => { syncEditingFromDom(); quickOpen = !quickOpen; render(); });
    // 暫存草稿：把原始劇本文字連同章節存起來，不解析、不關閉，之後可繼續寫
    root.querySelector("#story-quick-savedraft")?.addEventListener("click", async () => {
      syncEditingFromDom();
      if (!editing.title?.trim()) { alert("請先填章節標題，才能暫存草稿"); return; }
      try {
        const saved = await fetchJSON("/admin/story/chapters", { method: "POST", headers: headers(), body: JSON.stringify(editing) });
        editing.id = saved.id; // 新章節取得 id，之後存回同一章
        chapters = await fetchJSON("/admin/story/chapters", { headers: headers() });
        const res = root.querySelector("#story-quick-result");
        if (res) res.textContent = `💾 草稿已暫存（${new Date().toLocaleTimeString("zh-TW", { hour12: false })}）— 之後打開這章會帶回`;
        logMsg("快速編寫草稿已暫存");
      } catch (e) { alert("暫存失敗：" + e.message); }
    });
    root.querySelector("#story-quick-parse")?.addEventListener("click", () => {
      const ta = root.querySelector("#story-quick-text");
      const text = ta?.value || "";
      if (!text.trim()) return;
      const { nodes, unknownNpc, unknownMon } = parseScript(text);
      if (!nodes.length) return;
      syncEditingFromDom(); pushUndo();
      editing.nodes.push(...nodes);
      editing.scriptDraft = ""; // 已解析成節點 → 清掉原始草稿(避免重複解析)
      quickOpen = true; render();
      const resEl = root.querySelector("#story-quick-result");
      const msgs = [`✅ 已加入 ${nodes.length} 節點（原始草稿已清空，內容都在下方節點裡）`];
      if (unknownNpc.length) msgs.push(`⚠️ 未知角色（以名字覆寫顯示、無立繪）：${unknownNpc.join("、")} → 可先建人物卡再重選`);
      if (unknownMon.length) msgs.push(`⚠️ 找不到怪物：${unknownMon.join("、")} → 請在節點裡手動選`);
      if (resEl) resEl.textContent = msgs.join("　");
      logMsg(msgs.join(" "));
    });

    // 加節點（對話自動沿用上一位說話者）
    const addNode = (node) => { syncEditingFromDom(); pushUndo(); editing.nodes.push(node); render(); };
    root.querySelector("#story-node-add-narration")?.addEventListener("click", () => addNode({ type: "narration", text: "", backgroundUrl: null, bgm: "", sfx: "" }));
    root.querySelector("#story-node-add-dialogue")?.addEventListener("click", () => addNode({ type: "dialogue", text: "", side: "left", portraitFx: "", npcId: lastSpeakerNpcId(), nameOverride: null, backgroundUrl: null, bgm: "", sfx: "" }));
    root.querySelector("#story-node-add-battle")?.addEventListener("click", () => addNode({ type: "battle", monsterId: monsters[0]?.id || null, mustWin: true, backgroundUrl: null, bgm: "", sfx: "" }));
    root.querySelector("#story-node-add-cg")?.addEventListener("click", () => addNode({ type: "cg", cgUrl: null, text: "", backgroundUrl: null, bgm: "", sfx: "", screenFx: "", textSpeed: "", clearStage: false }));

    // 型別切換
    root.querySelectorAll("[data-node-settype]").forEach((b) => b.addEventListener("click", () => {
      syncEditingFromDom(); pushUndo();
      const i = Number(b.dataset.nodeSettype), t = b.dataset.settype, n = editing.nodes[i];
      n.type = t;
      if (t === "dialogue") { if (!n.npcId) n.npcId = lastSpeakerNpcId(); if (!n.side) n.side = "left"; }
      if (t === "battle") { if (n.monsterId === undefined || n.monsterId === null) n.monsterId = monsters[0]?.id || null; if (n.mustWin === undefined) n.mustWin = true; }
      if (t === "cg" && n.cgUrl === undefined) n.cgUrl = null;
      render();
    }));
    // 演出收合
    root.querySelectorAll("[data-node-fx]").forEach((b) => b.addEventListener("click", () => {
      syncEditingFromDom(); const i = Number(b.dataset.nodeFx); fxOpen.has(i) ? fxOpen.delete(i) : fxOpen.add(i); render();
    }));
    // 下方插入（同型；對話沿用同角色）
    root.querySelectorAll("[data-node-insert]").forEach((b) => b.addEventListener("click", () => {
      syncEditingFromDom(); pushUndo();
      const i = Number(b.dataset.nodeInsert), cur = editing.nodes[i];
      const fresh = cur.type === "dialogue"
        ? { type: "dialogue", text: "", side: cur.side || "left", portraitFx: "", npcId: cur.npcId || lastSpeakerNpcId(), nameOverride: null, backgroundUrl: null, bgm: "", sfx: "" }
        : cur.type === "battle"
          ? { type: "battle", monsterId: monsters[0]?.id || null, mustWin: true, backgroundUrl: null, bgm: "", sfx: "" }
          : { type: "narration", text: "", backgroundUrl: null, bgm: "", sfx: "" };
      editing.nodes.splice(i + 1, 0, fresh); render();
    }));
    // 複製節點（含演出）
    root.querySelectorAll("[data-node-dup]").forEach((b) => b.addEventListener("click", () => {
      syncEditingFromDom(); pushUndo();
      const i = Number(b.dataset.nodeDup);
      editing.nodes.splice(i + 1, 0, JSON.parse(JSON.stringify(editing.nodes[i]))); render();
    }));
    // 排序/刪除
    root.querySelectorAll("[data-node-del]").forEach((b) => b.addEventListener("click", () => { syncEditingFromDom(); pushUndo(); editing.nodes.splice(Number(b.dataset.nodeDel), 1); render(); }));
    root.querySelectorAll("[data-node-up]").forEach((b) => b.addEventListener("click", () => { syncEditingFromDom(); pushUndo(); const i = Number(b.dataset.nodeUp); [editing.nodes[i - 1], editing.nodes[i]] = [editing.nodes[i], editing.nodes[i - 1]]; render(); }));
    root.querySelectorAll("[data-node-down]").forEach((b) => b.addEventListener("click", () => { syncEditingFromDom(); pushUndo(); const i = Number(b.dataset.nodeDown); [editing.nodes[i + 1], editing.nodes[i]] = [editing.nodes[i], editing.nodes[i + 1]]; render(); }));
    // 拖曳排序
    root.querySelectorAll("[data-drag]").forEach((h) => {
      h.addEventListener("dragstart", (e) => { dragIdx = Number(h.dataset.drag); e.dataTransfer.effectAllowed = "move"; });
    });
    root.querySelectorAll("[data-node-card]").forEach((card) => {
      card.addEventListener("dragover", (e) => { if (dragIdx == null) return; e.preventDefault(); card.classList.add("st-drag-over"); });
      card.addEventListener("dragleave", () => card.classList.remove("st-drag-over"));
      card.addEventListener("drop", (e) => {
        e.preventDefault(); card.classList.remove("st-drag-over");
        const to = Number(card.dataset.nodeCard);
        if (dragIdx == null || to === dragIdx) { dragIdx = null; return; }
        syncEditingFromDom(); pushUndo();
        const [moved] = editing.nodes.splice(dragIdx, 1);
        editing.nodes.splice(to, 0, moved);
        dragIdx = null; render();
      });
    });
    // 背景上傳/清除
    root.querySelectorAll("[data-node-bg]").forEach((inp) => inp.addEventListener("change", async () => { if (!inp.files?.[0]) return; syncEditingFromDom(); pushUndo(); editing.nodes[Number(inp.dataset.nodeBg)].backgroundUrl = await uploadNamed(inp.files[0], "background"); render(); }));
    root.querySelectorAll("[data-node-bg-pick]").forEach((b) => b.addEventListener("click", () => pickAsset("background", (url) => { syncEditingFromDom(); pushUndo(); editing.nodes[Number(b.dataset.nodeBgPick)].backgroundUrl = url; render(); })));
    root.querySelectorAll("[data-node-bg-clear]").forEach((b) => b.addEventListener("click", () => { syncEditingFromDom(); pushUndo(); editing.nodes[Number(b.dataset.nodeBgClear)].backgroundUrl = null; render(); }));
    // CG 上傳/清除
    root.querySelectorAll("[data-node-cg]").forEach((inp) => inp.addEventListener("change", async () => { if (!inp.files?.[0]) return; syncEditingFromDom(); pushUndo(); editing.nodes[Number(inp.dataset.nodeCg)].cgUrl = await uploadNamed(inp.files[0], "cg"); render(); }));
    root.querySelectorAll("[data-node-cg-pick]").forEach((b) => b.addEventListener("click", () => pickAsset("cg", (url) => { syncEditingFromDom(); pushUndo(); editing.nodes[Number(b.dataset.nodeCgPick)].cgUrl = url; render(); })));
    root.querySelectorAll("[data-node-cg-clear]").forEach((b) => b.addEventListener("click", () => { syncEditingFromDom(); pushUndo(); editing.nodes[Number(b.dataset.nodeCgClear)].cgUrl = null; render(); }));
    // 換 NPC → 重繪(讓表情差分下拉跟著換)
    root.querySelectorAll('select[data-field="npcId"]').forEach((sel) => sel.addEventListener("change", () => { syncEditingFromDom(); render(); }));
    // Ctrl+Enter＝下方接一句（同型、同角色）
    root.querySelectorAll("textarea[data-node][data-field='text']").forEach((ta) => ta.addEventListener("keydown", (e) => {
      if (!(e.key === "Enter" && (e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      syncEditingFromDom(); pushUndo();
      const i = Number(ta.dataset.node), cur = editing.nodes[i];
      const fresh = cur.type === "dialogue"
        ? { type: "dialogue", text: "", side: cur.side || "left", portraitFx: "", npcId: cur.npcId || null, nameOverride: cur.nameOverride || null, backgroundUrl: null, bgm: "", sfx: "" }
        : { type: "narration", text: "", backgroundUrl: null, bgm: "", sfx: "" };
      editing.nodes.splice(i + 1, 0, fresh);
      render();
      root.querySelector(`textarea[data-node="${i + 1}"][data-field="text"]`)?.focus();
    }));
    // ── 即時預覽：焦點在哪一句 → 右側預覽跟著換；邊打字邊更新 ──
    root.querySelectorAll("[data-node]").forEach((el) => el.addEventListener("focusin", () => {
      const i = Number(el.dataset.node);
      if (!Number.isNaN(i)) { livePreviewIdx = i; renderLivePreview(); }
    }));
    root.querySelectorAll("textarea[data-node][data-field='text']").forEach((ta) => ta.addEventListener("input", () => {
      const i = Number(ta.dataset.node);
      if (editing.nodes[i]) editing.nodes[i].text = ta.value;
      livePreviewIdx = i; renderLivePreview();
    }));
    renderLivePreview();
  }

  // ── 即時預覽（右側面板，跟著正在編輯的節點；背景走「往回找最近一張」與正式閱讀器一致） ──
  let livePreviewIdx = 0;
  let livePreviewOn = true;
  let liveBgmTrack = null; // 即時預覽目前實際在播的曲目 key(避免每次重繪重啟音樂)
  function buildStageHTML(nodes, idx) {
    const npcById = Object.fromEntries(npcs.map((n) => [n.id, n]));
    const chapterBg = editing?.backgroundUrl || (editing?.zoneKey ? `/uploads/zones/${editing.zoneKey}.webp` : null);
    const n = nodes[idx];
    if (!n) return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c4a7f5;">📖 章節結束</div>`;
    let bg = chapterBg; for (let i = idx; i >= 0; i--) { if (nodes[i]?.backgroundUrl) { bg = nodes[i].backgroundUrl; break; } }
    const exprUrl = (npc, name) => { const e = (npc?.expressions || []).find((x) => x && x.name === name); return e?.url || null; };
    const nodePortrait = (nn) => { const npc = npcById[nn.npcId]; return exprUrl(npc, nn.expression) || npc?.portraitUrl || null; };
    const st = {};
    for (let i = 0; i <= idx; i++) { const nn = nodes[i]; if (!nn) continue; if (nn.clearStage) Object.keys(st).forEach((k) => delete st[k]); if (nn.type === "dialogue" && nodePortrait(nn)) st[nn.side || "left"] = { url: nodePortrait(nn), fx: nn.portraitFx }; }
    const isDlg = n.type === "dialogue", isBattle = n.type === "battle", isCG = n.type === "cg";
    const npc = isDlg ? npcById[n.npcId] : null;
    const name = isDlg ? (n.npcId === "player" ? "（玩家）" : (n.nameOverride || npc?.name || "???")) : "";
    const portraitsHtml = isCG ? "" : Object.entries(st).map(([side, p]) => {
      const pos = side === "center" ? "left:50%;transform:translateX(-50%);" : side === "right" ? "right:4%;" : "left:4%;";
      const speaking = isDlg && n.side === side; const dim = (isDlg && !speaking) || p.fx === "dim" ? "filter:brightness(.5);" : "";
      return `<img src="${esc(p.url)}" style="position:absolute;bottom:7rem;${pos}${dim}max-height:52%;max-width:70%;object-fit:contain;z-index:${speaking ? 3 : 1};">`;
    }).join("");
    const cgHtml = isCG && n.cgUrl ? `<div style="position:absolute;inset:0;background:url('${esc(n.cgUrl)}') center/cover;"></div>` : "";
    const noBox = isCG && !String(n.text || "").trim();
    // 畫面效果 / 音效 / BGM（BGM 走「往回找最近一句設的」與正式閱讀器一致）
    const fxOverlay = n.screenFx === "flash" ? `<div style="position:absolute;inset:0;background:#fff;z-index:8;animation:stPvFlash .45s forwards;"></div>`
      : n.screenFx === "fadeblack" ? `<div style="position:absolute;inset:0;background:#000;z-index:8;animation:stPvFade .9s forwards;"></div>` : "";
    const shakeAnim = n.screenFx === "shake" ? "animation:stPvShake .4s;" : "";
    let curBgm = ""; for (let i = idx; i >= 0; i--) { if (nodes[i]?.bgm) { curBgm = nodes[i].bgm; break; } }
    const badges = [
      curBgm ? `🎵 ${esc(curBgm === "zone" ? "地圖曲" : curBgm)}` : "",
      n.sfx ? `🔊 ${esc(n.sfx)}` : "",
      n.screenFx ? `🎞️ ${esc(n.screenFx)}` : ""
    ].filter(Boolean).join("　");
    return `
      <div style="position:absolute;inset:0;${shakeAnim}">
        ${bg ? `<div style="position:absolute;inset:0;background:url('${esc(bg)}') center/cover;"></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,6,14,.25),rgba(8,6,14,.8));"></div>` : ""}
        ${cgHtml}${portraitsHtml}
        ${badges ? `<div style="position:absolute;top:6px;left:6px;right:6px;z-index:7;font-size:10px;color:#cbb3f2;background:rgba(6,8,18,.6);padding:2px 6px;border-radius:6px;">${badges}</div>` : ""}
        ${noBox ? `<div style="position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#fff;font-size:12px;">（CG 無字幕）</div>` : `
        <div style="position:absolute;left:8px;right:8px;bottom:8px;padding:12px;min-height:5rem;background:linear-gradient(180deg,${isBattle ? "rgba(58,24,34,.96),rgba(24,12,20,.98)" : "rgba(30,24,58,.96),rgba(16,12,32,.98)"});border:1.5px solid ${isBattle ? "#ff5577" : "#c4a7f5"};border-radius:10px;">
          ${isBattle ? `<div style="text-align:center;color:#ff8a4a;font-weight:900;">⚔️ 戰鬥 ${esc((monsters.find((m) => m.id === n.monsterId) || {}).name || "（未選怪）")}</div>`
            : `${isDlg ? `<div style="color:#c4a7f5;font-weight:900;margin-bottom:4px;">${esc(name)}</div>` : ""}<div style="color:${isDlg ? "#f3ecff" : "#cdbce8"};${isDlg ? "" : "font-style:italic;"}line-height:1.6;white-space:pre-wrap;">${esc(n.text || "")}</div>`}
        </div>`}
        ${fxOverlay}
      </div>`;
  }
  const PREVIEW_RESERVE = 312; // 為預覽保留的右側空間(px)
  function setEditorReserve(on) {
    // 幫編輯區內容留出右側空間，預覽坐在留白裡、不擋節點按鈕（視窗夠寬才留）
    if (root) root.style.marginRight = (on && window.innerWidth > 960) ? PREVIEW_RESERVE + "px" : "";
  }
  function renderLivePreview() {
    let panel = document.getElementById("story-live-preview");
    let showBtn = document.getElementById("story-live-show");
    if (!editing) { if (panel) panel.style.display = "none"; if (showBtn) showBtn.style.display = "none"; setEditorReserve(false); stopLiveBgm(); return; }
    if (!livePreviewOn) {
      if (panel) panel.style.display = "none";
      setEditorReserve(false);
      stopLiveBgm();
      if (!showBtn) { showBtn = document.createElement("button"); showBtn.id = "story-live-show"; showBtn.className = "button"; showBtn.textContent = "👁 開預覽"; showBtn.style.cssText = "position:fixed;top:64px;right:14px;z-index:41;padding:4px 10px;"; showBtn.addEventListener("click", () => { livePreviewOn = true; renderLivePreview(); }); document.body.appendChild(showBtn); }
      showBtn.style.display = "block";
      return;
    }
    if (showBtn) showBtn.style.display = "none";
    setEditorReserve(true);
    if (!panel) { panel = document.createElement("div"); panel.id = "story-live-preview"; panel.style.cssText = "position:fixed;top:64px;right:14px;width:288px;z-index:40;"; document.body.appendChild(panel); }
    panel.style.display = "block";
    const nodes = (editing.nodes) || [];
    const idx = Math.max(0, Math.min(livePreviewIdx, Math.max(0, nodes.length - 1)));
    panel.innerHTML = `
      <div style="font-size:11px;color:#c4a7f5;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">
        <span>👁 即時預覽 · #${idx + 1}</span><button class="button" id="story-live-hide" style="padding:1px 7px;">✕ 收起</button>
      </div>
      <div style="position:relative;width:288px;height:512px;background:#0a0712;border:1px solid #c4a7f5;border-radius:12px;overflow:hidden;">${buildStageHTML(nodes, idx)}</div>`;
    panel.querySelector("#story-live-hide")?.addEventListener("click", () => { livePreviewOn = false; renderLivePreview(); });

    // 即時預覽：真的播出 BGM（與畫面上的 🎵 徽章一致）。只有「解析後的曲目」變了才重播，避免每次打字重啟。
    // 本章預覽 modal 開著時不搶音樂（兩者共用同一個 previewAudio）。
    if (!document.getElementById("pv-stage")) {
      let curBgm = ""; for (let i = idx; i >= 0; i--) { if (nodes[i]?.bgm) { curBgm = nodes[i].bgm; break; } }
      const zoneTrack = ZONE_BGM[editing.zoneKey] || "home";
      const resolved = !curBgm ? null : curBgm === "silence" ? "silence" : curBgm === "zone" ? zoneTrack : curBgm;
      if (resolved !== liveBgmTrack) {
        liveBgmTrack = resolved;
        if (!resolved || resolved === "silence") stopPreviewAudio();
        else playPreviewBgm(resolved);
      }
    }
  }
  function stopLiveBgm() { liveBgmTrack = null; stopPreviewAudio(); }

  // ── 本章預覽 modal ──
  let previewAudio = null;
  function stopPreviewAudio() { if (previewAudio) { try { previewAudio.pause(); } catch (_) {} previewAudio = null; } }
  function playPreviewBgm(track) {
    if (track === "silence") { stopPreviewAudio(); return; }
    const src = BGM_SRC[track]; if (!src) return;
    stopPreviewAudio();
    previewAudio = new Audio(src); previewAudio.loop = true; previewAudio.volume = 0.35;
    previewAudio.play().catch(() => {});
  }

  function openPreview(startIdx = 0) {
    const nodes = editing.nodes || [];
    const zoneTrack = ZONE_BGM[editing.zoneKey] || "home";
    const chapterBg = editing.backgroundUrl || (editing.zoneKey ? `/uploads/zones/${editing.zoneKey}.webp` : null);
    let idx = Math.max(0, Math.min(startIdx, nodes.length));
    const npcById = Object.fromEntries(npcs.map((n) => [n.id, n]));

    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;";
    ov.innerHTML = `<div style="position:relative;width:min(420px,94vw);height:min(760px,92vh);background:#0a0712;border:1px solid #c4a7f5;border-radius:14px;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;right:0;z-index:5;display:flex;justify-content:space-between;padding:8px 12px;font-size:12px;color:#cbb3f2;">
        <span id="pv-title"></span><button id="pv-close" class="button" style="padding:2px 10px;">✕ 關閉</button>
      </div>
      <div id="pv-stage" style="position:absolute;inset:0;cursor:pointer;background:#0a0712;"></div>
    </div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector("#pv-stage");
    const titleEl = ov.querySelector("#pv-title");

    function curBg() { for (let i = idx; i >= 0; i--) { if (nodes[i]?.backgroundUrl) return nodes[i].backgroundUrl; } return chapterBg; }
    // B1:表情差分取圖  B2:重播算出台上立繪
    function exprUrl(npc, name) { const e = (npc?.expressions || []).find((x) => x && x.name === name); return e?.url || null; }
    function nodePortrait(n) { const npc = npcById[n.npcId]; return (exprUrl(npc, n.expression) || npc?.portraitUrl || null); }
    function computeStage(upto) {
      const st = {};
      for (let i = 0; i <= upto; i++) { const n = nodes[i]; if (!n) continue; if (n.clearStage) Object.keys(st).forEach((k) => delete st[k]); if (n.type === "dialogue" && nodePortrait(n)) st[n.side || "left"] = { url: nodePortrait(n), fx: n.portraitFx }; }
      return st;
    }
    const SPEED = { slow: 2.1, normal: 1, fast: 0.45 };

    function renderNode() {
      const n = nodes[idx];
      titleEl.textContent = `${editing.title || "(未命名)"}　${idx + 1}/${nodes.length}`;
      if (!n) { stage.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c4a7f5;font-weight:900;">📖 章節結束</div>`; stopPreviewAudio(); return; }
      if (n.bgm) playPreviewBgm(n.bgm === "zone" ? zoneTrack : n.bgm);
      const bg = curBg();
      const isDlg = n.type === "dialogue", isBattle = n.type === "battle", isCG = n.type === "cg";
      const npc = isDlg ? npcById[n.npcId] : null;
      const name = isDlg ? (n.npcId === "player" ? "（玩家）" : (n.nameOverride || npc?.name || "???")) : "";
      const sfxTag = n.sfx ? `<div style="position:absolute;top:34px;right:10px;font-size:11px;color:#9b8cc0;z-index:6;">🔊 ${esc(n.sfx)}</div>` : "";
      // B2:台上立繪
      const st = computeStage(idx);
      const portraitsHtml = isCG ? "" : Object.entries(st).map(([side, p]) => {
        const pos = side === "center" ? "left:50%;transform:translateX(-50%);" : side === "right" ? "right:4%;" : "left:4%;";
        const anim = FX_ANIM[p.fx || ""] || FX_ANIM[""];
        const speaking = isDlg && n.side === side;
        const dim = (isDlg && !speaking) || p.fx === "dim" ? "filter:brightness(.5);" : "";
        return `<img src="${esc(p.url)}" style="position:absolute;bottom:8rem;${pos}${dim}max-height:52%;max-width:70%;object-fit:contain;animation:${anim};z-index:${speaking ? 3 : 1};">`;
      }).join("");
      const cgHtml = isCG && n.cgUrl ? `<div style="position:absolute;inset:0;background:url('${esc(n.cgUrl)}') center/cover;"></div>` : "";
      // B3:畫面效果
      const fxOverlay = n.screenFx === "flash" ? `<div style="position:absolute;inset:0;background:#fff;z-index:8;animation:stPvFlash .45s forwards;"></div>`
        : n.screenFx === "fadeblack" ? `<div style="position:absolute;inset:0;background:#000;z-index:8;animation:stPvFade .9s forwards;"></div>` : "";
      const shakeAnim = n.screenFx === "shake" ? "animation:stPvShake .4s;" : "";
      const noBox = isCG && !String(n.text || "").trim();

      stage.innerHTML = `
        <div style="position:absolute;inset:0;${shakeAnim}">
          ${bg ? `<div style="position:absolute;inset:0;background:url('${esc(bg)}') center/cover;"></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,6,14,.25),rgba(8,6,14,.8));"></div>` : ""}
          ${cgHtml}
          ${portraitsHtml}
          ${noBox ? `<div style="position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#fff;font-size:12px;">點擊繼續 ▼</div>` : `
          <div style="position:absolute;left:8px;right:8px;bottom:8px;padding:12px;min-height:6rem;background:linear-gradient(180deg,${isBattle ? "rgba(58,24,34,.96),rgba(24,12,20,.98)" : "rgba(30,24,58,.96),rgba(16,12,32,.98)"});border:1.5px solid ${isBattle ? "#ff5577" : "#c4a7f5"};border-radius:10px;">
            ${isBattle
              ? `<div style="text-align:center;color:#ff8a4a;font-weight:900;">⚔️ 戰鬥${n.mustWin !== false ? "（必勝）" : ""}</div><div style="text-align:center;color:#f3ecff;font-weight:900;margin-top:4px;">${esc((monsters.find((m) => m.id === n.monsterId) || {}).name || "（未選怪）")}</div><div class="hint" style="text-align:center;margin-top:6px;">（預覽不實際戰鬥）點擊繼續 ▶</div>`
              : `${isDlg ? `<div style="color:#c4a7f5;font-weight:900;margin-bottom:4px;">${esc(name)}</div>` : ""}<div id="pv-text" style="color:${isDlg ? "#f3ecff" : "#cdbce8"};${isDlg ? "" : "font-style:italic;"}line-height:1.6;white-space:pre-wrap;"></div><div style="text-align:right;color:#9b8cc0;font-size:11px;margin-top:4px;">點擊繼續 ▼</div>`}
          </div>`}
        </div>
        ${sfxTag}${fxOverlay}`;

      if (!isBattle) {
        const txt = String(n.text || ""), tEl = stage.querySelector("#pv-text"); let k = 0;
        clearInterval(stage._tw);
        if (tEl) stage._tw = setInterval(() => { k++; tEl.textContent = txt.slice(0, k); if (k >= txt.length) clearInterval(stage._tw); }, 28 * (SPEED[n.textSpeed] || 1));
      }
    }
    function advance() { clearInterval(stage._tw); if (idx < nodes.length) idx++; renderNode(); }
    function close() { clearInterval(stage._tw); stopPreviewAudio(); liveBgmTrack = null; ov.remove(); renderLivePreview(); }

    stage.addEventListener("click", advance);
    ov.querySelector("#pv-close").addEventListener("click", (e) => { e.stopPropagation(); close(); });
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    renderNode();
  }

  // ── 觸發載入（穩健版：不依賴綁在 nav 節點上的 listener，改用事件委派 + 分頁可見偵測）──
  let hasLoaded = false;
  function safeLoad(force) {
    if (hasLoaded && !force) return;
    hasLoaded = true;
    root.innerHTML = '<p class="hint">載入中…</p>';
    loadAll().catch((e) => {
      hasLoaded = false;
      root.innerHTML = `<p class="hint" style="color:#ff9a8f;">載入失敗：${esc(e.message)}<br>（多半是尚未登入／密碼未連線。請先到「基礎設定 → 登入連線」輸入管理員密碼並連線，再回到本頁。）</p>
        <button class="button primary" id="story-retry-load" style="margin-top:8px;">🔄 重試載入</button>`;
      document.getElementById("story-retry-load")?.addEventListener("click", () => safeLoad(true));
    });
  }
  // 事件委派：點左側「劇本編輯工具」或右上「重新載入」都能載入（就算 nav 被搜尋功能重建也有效）
  document.addEventListener("click", (e) => {
    if (e.target.closest?.('[data-target="section-story"]')) setTimeout(() => safeLoad(false), 60);
    if (e.target.closest?.("#story-refresh-btn")) { stopDraft(); editing = null; npcForm = null; fxOpen.clear(); undoStack = []; redoStack = []; safeLoad(true); }
  });
  // 分頁被切成 active（class 變動）→ 自動載入一次
  function hideLivePreviewChrome() {
    const p = document.getElementById("story-live-preview"); if (p) p.style.display = "none";
    const b = document.getElementById("story-live-show"); if (b) b.style.display = "none";
    if (root) root.style.marginRight = "";
  }
  const sec = document.getElementById("section-story");
  if (sec) {
    const obs = new MutationObserver(() => {
      if (sec.classList.contains("active")) safeLoad(false);
      else hideLivePreviewChrome(); // 離開劇情頁 → 收掉即時預覽與右側留白，不擋別的頁
    });
    obs.observe(sec, { attributes: true, attributeFilter: ["class"] });
    if (sec.classList.contains("active")) safeLoad(false);
  }
})();
