// 主線劇情編輯器（完整劇本工具）
// Phase A：劇本文字模式 / 智慧預設 / 插入·複製·拖曳 / Undo·Redo / 自動草稿 / 搜尋·統計 / 儲存檢查 / 章節複製·匯出入
// 資料流：/admin/story/npcs、/admin/story/chapters、/admin/story/zones、/admin/story/monsters、/admin/story/upload
(function () {
  const root = document.getElementById("story-editor-root");
  if (!root) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 角色卡縮圖：Cloudinary 臉部裁切(e_trim 去透明邊 → c_fill 1:1 對臉 g_face)，直接看到臉不是全身。
  const faceThumb = (u) => {
    if (!u || typeof u !== "string" || !u.includes("res.cloudinary.com") || !u.includes("/upload/")) return u;
    if (!/\/upload\/(?:[^/]+\/)*?v\d+\//.test(u)) return u; // 沒有版本段就不動，避免裁到錯位置
    return u.replace(/\/upload\/(?:[^/]+\/)*?(v\d+\/)/, "/upload/e_trim/c_fill,ar_1:1,g_face,w_120,f_auto,q_auto/$1");
  };

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
      .st-node-card { scroll-margin-top: 3px; } /* Tab 捲上去時，卡片上緣留一點空隙不貼頂 */
      .st-node-card.st-drag-over { outline: 2px dashed #7ce0ff; outline-offset: 2px; }
      .st-drag-handle { cursor: grab; user-select: none; color: #6b7399; }
      .st-drag-handle:active { cursor: grabbing; }
      /* 演出面板的小下拉：不要被 select{width:100%} 撐滿整行 */
      select.st-sel { width: 132px !important; min-width: 0; flex: 0 0 auto; font-size: 12px; padding: 3px 6px !important; }
      /* 文字演出效果（預覽用） */
      @keyframes stTxtShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-1.5px)} 75%{transform:translateX(1.5px)} }
      @keyframes stTxtQuake { 0%{transform:translate(0,0)} 12%{transform:translate(-5px,2px)} 24%{transform:translate(5px,-2px)} 36%{transform:translate(-5px,1px)} 48%{transform:translate(4px,-2px)} 62%{transform:translate(-3px,1px)} 78%{transform:translate(2px,-1px)} 100%{transform:translate(0,0)} }
      .st-txt-quake{animation:stTxtQuake .5s ease-out both}
      @keyframes stTxtGlow { 0%,100%{text-shadow:0 0 3px rgba(196,167,245,.4)} 50%{text-shadow:0 0 11px rgba(196,167,245,.95)} }
      @keyframes stTxtPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
      @keyframes stTxtWave { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      .st-txt-shake{animation:stTxtShake .16s infinite}
      .st-txt-glow{animation:stTxtGlow 1.4s ease-in-out infinite}
      .st-txt-pulse{animation:stTxtPulse 1.2s ease-in-out infinite;transform-origin:left center}
      .st-txt-wave{animation:stTxtWave 1s ease-in-out infinite}
    `;
    document.head.appendChild(s);
  }

  // 全域 Ctrl+Z 復原 / Ctrl+Shift+Z(或 Ctrl+Y) 重做（拉動立繪/背景後可回到剛剛位子）。
  // 焦點在文字欄位時交給原生復原，不攔截。
  if (!window.__storyKeybound) {
    window.__storyKeybound = true;
    document.addEventListener("keydown", (e) => {
      if (!editing) return;
      const t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = String(e.key || "").toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); }
    });
  }

  // 演出選項（需與前端 sound.ts / story.tsx 一致）
  const BGM_OPTS = [
    ["", "🎵 BGM（不變）"], ["zone", "🗺️ 恢復地圖曲"], ["silence", "🔇 靜音"],
    ["home", "主頁曲"], ["beginner", "新手村"], ["normal", "起始草原"], ["mid", "陽光草原"],
    ["ancient", "古城"], ["ancient_deep", "古城深淵"], ["dragon_realm", "龍族之領"], ["daishi", "大史王"], ["dragon_king", "古龍王"],
    ["hellfire", "地獄火焰"], ["hellfang_king", "地獄狼牙王"],
    ["push_while_you_can", "🎼 趁能推的時候推"], ["swordsman_village", "🎼 劍士村莊"],
    ["adventure_journey", "🎼 冒險之途"], ["central_city", "🎼 中央主城"]
  ];
  const SFX_OPTS = [
    ["", "🔊 音效（無）"], ["win", "🎉 勝利"], ["crit", "💥 衝擊"], ["lightning", "⚡ 雷"], ["freeze", "❄️ 冰"],
    ["burn", "🔥 火"], ["poison", "☠️ 毒"], ["heal", "💚 治療"], ["block", "🛡️ 格擋"], ["lose", "💀 沉重"],
    ["chest", "🎁 寶箱"], ["item", "✨ 道具"], ["equip", "⚔️ 金屬"],
    ["hit_sword", "🗡️ 揮刀"], ["hit_bow", "🏹 射箭"], ["hit_axe", "🪓 揮斧"], ["hit_mace", "🔨 錘擊"],
    ["hit_dagger", "🔪 匕首"], ["hit_staff", "🪄 法杖"], ["hit_crit", "💢 暴擊命中"], ["hit_monster", "👹 怪物攻擊"]
  ];
  const SIDE_OPTS = [["left", "⬅️ 左"], ["center", "⏺️ 中"], ["right", "➡️ 右"]];
  // 退場：進此節點時把某位置的立繪移除（換人/角色離場用）；all＝全部移除
  const EXIT_OPTS = [["", "🚪 退場（無）"], ["left", "🚪 左退場"], ["center", "🚪 中退場"], ["right", "🚪 右退場"], ["all", "🚪 全部退場"]];
  // 文字大小（玩家端台詞字體）：空＝標準
  const TEXTSIZE_OPTS = [["", "🔤 標準"], ["small", "🔡 小"], ["large", "🔠 大"]];
  // 文字演出效果（台詞本身的動態）：空＝無
  const TEXTFX_OPTS = [["", "✨ 文字效果（無）"], ["shake", "💢 顫抖"], ["quake", "💥 震動(用力幾下)"], ["glow", "🌟 發光"], ["pulse", "💗 脈動"], ["wave", "🌊 波浪"]];
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
    swordsman_village: "/bgm/bgm-swordsman-village.mp3", adventure_journey: "/bgm/bgm-adventure-journey.mp3", central_city: "/bgm/bgm-central-city.mp3",
    hellfire: "/bgm/bgm-hellfire.mp3", hellfang_king: "/bgm/bgm-hellfang-king.mp3"
  };
  const ZONE_BGM = { beginner: "beginner", normal: "normal", mid: "mid", ancient_city: "ancient", ancient_city_deep: "ancient_deep", dragon_realm: "dragon_realm", elite: "daishi", dragon_king_lair: "dragon_king", hellfire: "hellfire", hellfire_depths: "hellfang_king" };
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
  async function loadAssets() { try { storyAssets = (await fetchJSON("/admin/story/assets", { headers: headers() })) || []; } catch (_) { storyAssets = []; } }
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
  async function pickAsset(kind, cb) {
    await loadAssets().catch(() => {}); // 每次開圖庫都重抓最新，不看舊快取(地圖/去重才會即時反映)
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
  function writeDraft() {
    if (!editing) return;
    try { localStorage.setItem(draftKeyOf(editing.id), JSON.stringify({ t: Date.now(), data: editing })); } catch (_) {}
  }
  function startDraft() {
    stopDraft();
    draftTimer = setInterval(() => {
      if (!editing) return;
      try { syncEditingFromDom(); writeDraft(); } catch (_) {}
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
        out.push({ type: "dialogue", npcId: npc?.id || null, nameOverride: npc ? null : name, side: "center", portraitFx: "", text: speech, backgroundUrl: null, bgm: "", sfx: "" });
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
        ${n.portraitUrl ? `<img src="${esc(faceThumb(n.portraitUrl))}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">` : `<div style="width:44px;height:44px;border-radius:8px;background:#232945;display:flex;align-items:center;justify-content:center;">🎭</div>`}
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
          ${npcForm.portraitUrl ? `<img src="${esc(faceThumb(npcForm.portraitUrl))}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">` : `<div style="width:44px;height:44px;border-radius:8px;background:#232945;display:flex;align-items:center;justify-content:center;">🎭</div>`}
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
               ${n.cgUrl ? `<img src="${esc(n.cgUrl)}" style="height:44px;border-radius:6px;"><button class="button" data-node-cg-clear="${i}">✖</button>` : ""}
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
          <div style="${ROW}margin-bottom:6px;">
            <label class="button" style="cursor:pointer;">🏞 背景<input type="file" accept="image/*" data-node-bg="${i}" style="display:none;"></label>
            <button class="button" data-node-bg-pick="${i}" title="從圖庫選">📁 圖庫</button>
            ${n.backgroundUrl ? `<img src="${esc(n.backgroundUrl)}" style="height:30px;border-radius:6px;"><button class="button" data-node-bg-clear="${i}">✖</button>` : '<span class="hint" style="margin:0;">未設＝沿用前景</span>'}
          </div>
          <div style="${ROW}margin-bottom:0;">
            ${isDlg ? `<select class="st-sel" data-node="${i}" data-field="side" title="立繪位置">${optionsHtml(SIDE_OPTS, n.side || "center")}</select>
            <select class="st-sel" data-node="${i}" data-field="portraitFx" title="立繪演出">${optionsHtml(FX_OPTS, n.portraitFx || "")}</select>` : ""}
            <select class="st-sel" data-node="${i}" data-field="bgm">${optionsHtml(BGM_OPTS, n.bgm || "")}</select>
            <select class="st-sel" data-node="${i}" data-field="sfx">${optionsHtml(SFX_OPTS, n.sfx || "")}</select>
            <select class="st-sel" data-node="${i}" data-field="screenFx">${optionsHtml(SCREENFX_OPTS, n.screenFx || "")}</select>
            <select class="st-sel" data-node="${i}" data-field="textFx" title="文字演出效果">${optionsHtml(TEXTFX_OPTS, n.textFx || "")}</select>
            <select class="st-sel" data-node="${i}" data-field="textSpeed">${optionsHtml(SPEED_OPTS, n.textSpeed || "")}</select>
            <select class="st-sel" data-node="${i}" data-field="exitSide" title="讓某個位置的立繪退場(移除)；換人時舊角色不會自動消失，用這個把他移掉">${optionsHtml(EXIT_OPTS, n.exitSide || "")}</select>
            <label style="font-size:12px;" title="進場前清掉台上其他立繪(換場/獨白用)"><input type="checkbox" data-node="${i}" data-field="clearStage" ${n.clearStage ? "checked" : ""}> 🧹 清空其他立繪</label>
          </div>
        </div>` : "";
      const fxHint = [n.backgroundUrl && "🏞", (n.bgm && n.bgm !== "") && "🎵", (n.sfx && n.sfx !== "") && "🔊", (isDlg && n.portraitFx) && "🎭", (n.textFx && n.textFx !== "") && "✨", (n.screenFx && n.screenFx !== "") && "🎞️", (n.exitSide && n.exitSide !== "") && "🚪", n.clearStage && "🧹"].filter(Boolean).join(" ");

      return `
      <div class="st-node-card" data-node-card="${i}" style="${BOX}background:rgba(28,32,56,0.6);">
        <div style="${ROW}margin-bottom:6px;">
          <span class="st-drag-handle" draggable="true" data-drag="${i}" title="拖曳排序">⠿</span>
          <b style="color:#8b93b8;">#${i + 1}</b>
          ${typeBtn(i, "narration", n.type === "narration" || !n.type, "旁白")}
          ${typeBtn(i, "dialogue", n.type === "dialogue", "💬 對話")}
          ${typeBtn(i, "battle", n.type === "battle", "⚔️ 戰鬥")}
          ${typeBtn(i, "cg", n.type === "cg", "🖼 CG")}
          ${n.type !== "battle" ? `<select data-node="${i}" data-field="textSize" title="文字大小(玩家端台詞字體)" style="width:84px;flex:0 0 auto;padding:2px 6px;font-size:12px;">${optionsHtml(TEXTSIZE_OPTS, n.textSize || "")}</select>` : ""}
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
    root.querySelector("#story-node-add-dialogue")?.addEventListener("click", () => addNode({ type: "dialogue", text: "", side: "center", portraitFx: "", npcId: lastSpeakerNpcId(), nameOverride: null, backgroundUrl: null, bgm: "", sfx: "" }));
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
        ? { type: "dialogue", text: "", side: cur.side || "center", portraitFx: "", npcId: cur.npcId || lastSpeakerNpcId(), nameOverride: null, backgroundUrl: null, bgm: "", sfx: "" }
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
      // Tab：跳到下一句的文字框（Shift+Tab 跳上一句）；沒有就維持原生行為
      if (e.key === "Tab") {
        const i = Number(ta.dataset.node);
        const target = root.querySelector(`textarea[data-node="${e.shiftKey ? i - 1 : i + 1}"][data-field="text"]`);
        if (target) {
          e.preventDefault();
          target.focus({ preventScroll: true });
          const v = target.value; try { target.setSelectionRange(v.length, v.length); } catch (_) {}
          // 捲整張節點卡到畫面上方(含演出/角色列)，方便考慮演出與內容
          const card = target.closest(".st-node-card") || target;
          try { card.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { card.scrollIntoView(); }
        }
        return;
      }
      if (!(e.key === "Enter" && (e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      syncEditingFromDom(); pushUndo();
      const i = Number(ta.dataset.node), cur = editing.nodes[i];
      const fresh = cur.type === "dialogue"
        ? { type: "dialogue", text: "", side: cur.side || "center", portraitFx: "", npcId: cur.npcId || null, nameOverride: cur.nameOverride || null, backgroundUrl: null, bgm: "", sfx: "" }
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
  let lastSfxIdx = -1;     // 即時預覽上次播音效的節點(切節點才播一次)

  // 立繪/背景位置解析（與正式閱讀器一致）：
  //   stagePos[side]={x,y}（相對立繪自身大小的 % 位移，跨節點沿用）；bgPos={x,y}（background-position %）
  function portraitUrlOfNode(nn) {
    const npc = npcs.find((x) => x.id === nn.npcId);
    if (!npc) return null;
    const e = (npc.expressions || []).find((x) => x && x.name === nn.expression);
    return (e && e.url) || npc.portraitUrl || null;
  }
  function stageAt(nodes, idx) {
    const st = {}, pos = {}, occ = {}; // occ[side]=目前站該位置的角色 id（換人就把位移歸零＝置中）
    const clearAll = () => { [st, pos, occ].forEach((o) => Object.keys(o).forEach((k) => delete o[k])); };
    for (let i = 0; i <= idx; i++) {
      const nn = nodes[i]; if (!nn) continue;
      if (nn.clearStage) clearAll();
      if (nn.exitSide === "all") clearAll(); else if (nn.exitSide) { delete st[nn.exitSide]; delete pos[nn.exitSide]; delete occ[nn.exitSide]; }
      const own = nn.stagePos || {};
      if (nn.stagePos) for (const s of Object.keys(nn.stagePos)) { pos[s] = nn.stagePos[s]; if (st[s]) st[s].pos = nn.stagePos[s]; }
      if (nn.type === "dialogue") {
        const s = nn.side || "center", id = nn.npcId || "";
        if (occ[s] !== id && !own[s]) delete pos[s]; // 選了新立繪(換人)→回置中，除非本節點自訂了位置
        occ[s] = id;
        if (id === "player") { st[s] = { url: null, player: true, fx: nn.portraitFx, pos: pos[s] || null }; } // 主角＝登入者頭像(編輯器用佔位)
        else { const u = portraitUrlOfNode(nn); if (u) { st[s] = { url: u, player: false, fx: nn.portraitFx, pos: pos[s] || null }; } }
      }
    }
    return st;
  }
  function bgPosAt(nodes, idx) { for (let i = idx; i >= 0; i--) { if (nodes[i] && nodes[i].bgPos) return nodes[i].bgPos; } return null; }
  // 拉動起始位置（沿用當前實際顯示的位移，避免第一下跳位）
  function effectivePortraitPos(nodes, idx, side) { const st = stageAt(nodes, idx); return (st[side] && st[side].pos) || { x: 0, y: 0 }; }

  function buildStageHTML(nodes, idx, opts) {
    const ls = !!(opts && opts.landscape); // 橫向預覽：立繪更高更窄、對話框更矮
    const P = {
      portW: ls ? "40%" : "58%",      // 立繪最大寬(相對舞台)，與玩家端 reader 一致
      portH: ls ? "78%" : "100%",     // 立繪最大高：橫式限高留頭頂空間，避免頂到上緣被切
      phH: ls ? "50%" : "40%",        // 玩家立繪佔位高度(相對舞台)，正方形
      portBottom: ls ? "2.6rem" : "5rem", boxMinH: ls ? "2.4rem" : "5rem"
    };
    const npcById = Object.fromEntries(npcs.map((n) => [n.id, n]));
    const chapterBg = editing?.backgroundUrl || (editing?.zoneKey ? `/uploads/zones/${editing.zoneKey}.webp` : null);
    const n = nodes[idx];
    if (!n) return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c4a7f5;">📖 章節結束</div>`;
    let bg = chapterBg; for (let i = idx; i >= 0; i--) { if (nodes[i]?.backgroundUrl) { bg = nodes[i].backgroundUrl; break; } }
    const bgPos = bgPosAt(nodes, idx); // 背景平移(往回找最近設定)
    const exprUrl = (npc, name) => { const e = (npc?.expressions || []).find((x) => x && x.name === name); return e?.url || null; };
    const nodePortrait = (nn) => { const npc = npcById[nn.npcId]; return exprUrl(npc, nn.expression) || npc?.portraitUrl || null; };
    const st = stageAt(nodes, idx); // { side: {url,fx,pos} }（含位移，pos 跨節點沿用）
    const isDlg = n.type === "dialogue", isBattle = n.type === "battle", isCG = n.type === "cg";
    const npc = isDlg ? npcById[n.npcId] : null;
    const name = isDlg ? (n.npcId === "player" ? "（玩家）" : (n.nameOverride || npc?.name || "???")) : "";
    // 立繪：與玩家端 reader「完全相同」的排版(flex 佔滿舞台依 side 靠齊、max-height=舞台%、貼底、位移/縮放上 transform)
    // → 預覽=實際。✕/⤢ 握把不放這裡，改由 JS 依立繪實際框位置疊上去(見 attachPreviewDrag)。
    const portraitsHtml = isCG ? "" : Object.entries(st).map(([side, p]) => {
      const ps = p.pos?.s || 1; // 縮放；水平由 side(flex)決定＝置中/靠邊
      const oy = p.pos?.y || 0;  // 垂直位移(%)：正值往下（拖立繪本身上下移動）
      const speaking = isDlg && n.side === side; const dim = (isDlg && !speaking) || p.fx === "dim" ? "filter:brightness(.5);" : "";
      const justify = side === "center" ? "center" : side === "right" ? "flex-end" : "flex-start";
      const tf = `transform:scale(${ps});transform-origin:bottom center;`;
      const el = p.player
        ? `<div data-drag-portrait="${side}" style="height:${P.phH};aspect-ratio:1;box-sizing:border-box;${dim}${tf}display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(196,167,245,.3),rgba(60,42,104,.45));border:2px dashed #c4a7f5;border-radius:14px;color:#efe7ff;cursor:ns-resize;touch-action:none;text-align:center;pointer-events:auto;"><div style="font-size:34px;line-height:1;">🧑</div><div style="font-size:11px;font-weight:900;margin-top:6px;white-space:nowrap;">玩家立繪</div></div>`
        : `<img data-drag-portrait="${side}" src="${esc(p.url)}" style="max-height:${P.portH};max-width:${P.portW};flex:0 0 auto;${dim}${tf}cursor:ns-resize;touch-action:none;pointer-events:auto;">`;
      return `<div data-portrait-side="${side}" style="position:absolute;left:3%;right:3%;top:0;bottom:${P.portBottom};display:flex;align-items:flex-end;justify-content:${justify};z-index:${speaking ? 3 : 1};pointer-events:none;${oy ? `transform:translateY(${oy}%);` : ""}">${el}</div>`;
    }).join("");
    const cgHtml = isCG && n.cgUrl ? `<div data-drag-cg style="position:absolute;inset:0;background-image:url('${esc(n.cgUrl)}');background-size:cover;background-position:${n.cgPos ? `${n.cgPos.x}% ${n.cgPos.y}%` : "center"};${n.cgPos && n.cgPos.z ? `transform:scale(${n.cgPos.z});transform-origin:center;` : ""}cursor:grab;touch-action:none;"></div>` : "";
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
        ${bg ? `<div data-drag-bg style="position:absolute;inset:0;background-image:url('${esc(bg)}');background-size:cover;background-position:${bgPos ? `${bgPos.x}% ${bgPos.y}%` : "center"};${bgPos && bgPos.z ? `transform:scale(${bgPos.z});transform-origin:center;` : ""}cursor:grab;touch-action:none;"></div>` : ""}
        ${cgHtml}${portraitsHtml}
        ${(bg || (isCG && n.cgUrl)) ? `<div data-resize-${isCG && n.cgUrl ? "cg" : "bg"} title="拉動改變${isCG && n.cgUrl ? "CG" : "背景"}大小" style="position:absolute;top:50%;right:6px;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;background:#7ce0ff;color:#08222e;border:2px solid #1a1030;font-size:14px;line-height:24px;text-align:center;cursor:nwse-resize;touch-action:none;z-index:6;box-shadow:0 1px 6px rgba(0,0,0,.6);">⤢</div>` : ""}
        ${badges ? `<div style="position:absolute;top:6px;left:6px;right:6px;z-index:7;font-size:10px;color:#cbb3f2;background:rgba(6,8,18,.6);padding:2px 6px;border-radius:6px;">${badges}</div>` : ""}
        ${noBox ? `<div style="position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#fff;font-size:12px;">（CG 無字幕）</div>` : `
        <div style="position:absolute;left:8px;right:8px;bottom:8px;z-index:5;padding:${ls ? "7px 10px" : "12px"};min-height:${P.boxMinH};background:linear-gradient(180deg,${isBattle ? "rgba(58,24,34,.96),rgba(24,12,20,.98)" : "rgba(30,24,58,.96),rgba(16,12,32,.98)"});border:1.5px solid ${isBattle ? "#ff5577" : "#c4a7f5"};border-radius:10px;">
          ${isBattle ? `<div style="text-align:center;color:#ff8a4a;font-weight:900;">⚔️ 戰鬥 ${esc((monsters.find((m) => m.id === n.monsterId) || {}).name || "（未選怪）")}</div>`
            : `${isDlg ? `<div style="color:#c4a7f5;font-weight:900;font-size:14px;margin-bottom:4px;">${esc(name)}</div>` : ""}<div class="${n.textFx ? "st-txt-" + esc(n.textFx) : ""}" style="color:${isDlg ? "#f3ecff" : "#cdbce8"};${isDlg ? "" : "font-style:italic;"}font-size:${n.textSize === "small" ? 12 : n.textSize === "large" ? 18 : 14}px;line-height:1.6;white-space:pre-wrap;">${esc(n.text || "")}</div>`}
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
      <div style="font-size:10px;color:#8b93b8;margin-bottom:2px;">📱 直式（手機預設）</div>
      <div class="st-stage" style="position:relative;width:288px;height:512px;background:#0a0712;border:1px solid #c4a7f5;border-radius:12px;overflow:hidden;">${buildStageHTML(nodes, idx, { landscape: false })}</div>
      <p class="hint" style="margin:4px 0 0;font-size:10px;">立繪左右＝用「🎭立繪：左/中/右」下拉；直接拖立繪＝上下移動；藍 ⤢＝改大小(往上放大)、✕＝移除；背景/CG 可拖曳移動。放開自動存，Ctrl+Z 復原</p>
      <div style="font-size:10px;color:#8b93b8;margin:8px 0 2px;">🖥 橫式 16:9（網頁／手機橫放全螢幕）</div>
      <div style="position:relative;width:288px;height:162px;background:#0a0712;border:1px solid #6b7399;border-radius:10px;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;width:640px;height:360px;transform:scale(0.45);transform-origin:top left;">${buildStageHTML(nodes, idx, { landscape: true })}</div>
      </div>`;
    panel.querySelector("#story-live-hide")?.addEventListener("click", () => { livePreviewOn = false; renderLivePreview(); });
    attachPreviewDrag(panel, idx);

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
      // 一次性音效：只有「切到不同節點」才播（打字不重播）
      if (lastSfxIdx !== idx) {
        lastSfxIdx = idx;
        if (nodes[idx] && nodes[idx].sfx) playPreviewSfx(nodes[idx].sfx);
      }
    }
  }
  function stopLiveBgm() { liveBgmTrack = null; stopPreviewAudio(); }

  // 即時預覽拖曳：拖背景→改該節點 bgPos(%)；拖立繪→改該節點 stagePos[side](相對立繪大小 %)。
  // 按下先 pushUndo(→Ctrl+Z 可回)，放開自動寫草稿並重繪。
  function attachPreviewDrag(panel, idx) {
    const stage = panel.querySelector(".st-stage"); if (!stage) return;
    const node = () => editing && editing.nodes && editing.nodes[idx];

    // ── ✕(移除)/⤢(改大小) 握把：疊在舞台上、依立繪「實際框」定位、固定大小(不隨縮放)。
    function positionHandles() {
      const sr = stage.getBoundingClientRect();
      stage.querySelectorAll("[data-drag-portrait]").forEach((el) => {
        if (!el._rm) return;
        const r = el.getBoundingClientRect();
        const top = Math.max(2, r.top - sr.top + 2); // 貼在立繪內側上緣，避免被舞台 overflow 切掉
        el._rm.style.left = (r.right - sr.left - 28) + "px"; el._rm.style.top = top + "px";
        el._rz.style.left = (r.left - sr.left + 2) + "px"; el._rz.style.top = top + "px";
      });
    }
    function doRemove(side) {
      const nd = node(); if (!nd) return;
      pushUndo();
      if (nd.exitSide === side) nd.exitSide = null;
      else if (!nd.exitSide) nd.exitSide = side;
      else nd.exitSide = "all";
      writeDraft(); render(); renderLivePreview();
    }
    function makeHandles() {
      stage.querySelectorAll(".st-phandle").forEach((h) => h.remove());
      stage.querySelectorAll("[data-drag-portrait]").forEach((el) => {
        const side = el.getAttribute("data-drag-portrait");
        const rm = document.createElement("button"); rm.className = "st-phandle"; rm.textContent = "✕"; rm.title = "移除此立繪(從這句起退場)";
        rm.style.cssText = "position:absolute;width:26px;height:26px;border-radius:50%;background:#ff5577;color:#fff;border:2px solid #1a1030;font-size:15px;line-height:22px;text-align:center;cursor:pointer;z-index:8;padding:0;box-shadow:0 1px 6px rgba(0,0,0,.6);";
        const rz = document.createElement("div"); rz.className = "st-phandle"; rz.textContent = "⤢"; rz.title = "拉動改變大小(往上放大)";
        rz.style.cssText = "position:absolute;width:26px;height:26px;border-radius:50%;background:#7ce0ff;color:#08222e;border:2px solid #1a1030;font-size:14px;line-height:22px;text-align:center;cursor:nwse-resize;touch-action:none;z-index:8;box-shadow:0 1px 6px rgba(0,0,0,.6);";
        stage.appendChild(rm); stage.appendChild(rz); el._rm = rm; el._rz = rz;
        rm.addEventListener("pointerdown", (e) => e.stopPropagation());
        rm.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); doRemove(side); });
        rz.addEventListener("pointerdown", (e) => onDown(e, "presize", side, el));
        if (el.tagName === "IMG" && !el.complete) el.addEventListener("load", positionHandles, { once: true });
      });
      positionHandles();
    }

    let drag = null;
    const onDown = (e, kind, side, el) => {
      const nd = node(); if (!nd) return;
      e.preventDefault(); e.stopPropagation();
      pushUndo();
      if (kind === "presize") {                       // 立繪縮放（保留垂直位移 y）
        const base = (nd.stagePos && nd.stagePos[side]) || effectivePortraitPos(editing.nodes, idx, side) || {};
        const y = Number(base.y) || 0, s0 = Number(base.s) || 1;
        nd.stagePos = nd.stagePos || {}; nd.stagePos[side] = y ? { s: s0, y } : { s: s0 };
        drag = { kind, side, el, sy: e.clientY, base: { y, s: s0 } };
      } else if (kind === "pmoveY") {                 // 立繪：只上下移動（左右由 side 下拉決定，避免水平飄移）
        const wrap = el.closest("[data-portrait-side]");
        const base = (nd.stagePos && nd.stagePos[side]) || effectivePortraitPos(editing.nodes, idx, side) || {};
        const y = Number(base.y) || 0, s0 = Number(base.s) || 1;
        nd.stagePos = nd.stagePos || {}; nd.stagePos[side] = s0 !== 1 ? { y, s: s0 } : (y ? { y } : {});
        drag = { kind, side, el, wrap, sy: e.clientY, base: { y, s: s0 }, wh: (wrap && wrap.getBoundingClientRect().height) || stage.clientHeight || 400 };
      } else if (kind === "lresize") {                // 背景/CG 縮放
        const field = side, layer = stage.querySelector(field === "bgPos" ? "[data-drag-bg]" : "[data-drag-cg]");
        const base = nd[field] || (field === "cgPos" ? { x: 50, y: 50 } : (bgPosAt(editing.nodes, idx) || { x: 50, y: 50 }));
        nd[field] = { x: base.x, y: base.y, z: base.z || 1 };
        drag = { kind, field, layer, sy: e.clientY, base: { ...base } };
      } else if (kind === "bg" || kind === "cg") {    // 背景/CG 移動
        const field = kind === "cg" ? "cgPos" : "bgPos";
        const base = (kind === "cg" ? nd.cgPos : bgPosAt(editing.nodes, idx)) || { x: 50, y: 50 };
        nd[field] = base.z ? { x: base.x, y: base.y, z: base.z } : { x: base.x, y: base.y };
        drag = { kind, field, el, sx: e.clientX, sy: e.clientY, base: { ...base }, sw: stage.clientWidth || 288, sh: stage.clientHeight || 512 };
      }
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const onMove = (e) => {
      if (!drag) return; const nd = node(); if (!nd) return;
      const ddx = e.clientX - drag.sx, ddy = e.clientY - drag.sy;
      if (drag.kind === "presize") {
        const s = Math.max(0.3, Math.min(3, Math.round(((drag.base.s || 1) - (e.clientY - drag.sy) / 160) * 100) / 100));
        const y = drag.base.y || 0;
        nd.stagePos[drag.side] = y ? { s, y } : { s };
        drag.el.style.transform = `scale(${s})`;
        positionHandles();
      } else if (drag.kind === "pmoveY") {              // 立繪上下移動（正值往下）
        const y = Math.max(-90, Math.min(90, Math.round(drag.base.y + ddy / drag.wh * 100)));
        const s = drag.base.s || 1;
        nd.stagePos[drag.side] = s !== 1 ? { y, s } : { y };
        if (drag.wrap) drag.wrap.style.transform = y ? `translateY(${y}%)` : "";
        positionHandles();
      } else if (drag.kind === "lresize") {
        const z = Math.max(0.5, Math.min(3, Math.round(((drag.base.z || 1) - (e.clientY - drag.sy) / 220) * 100) / 100));
        nd[drag.field] = { x: drag.base.x, y: drag.base.y, z };
        if (drag.layer) { drag.layer.style.transformOrigin = "center"; drag.layer.style.transform = `scale(${z})`; }
      } else if (drag.kind === "bg" || drag.kind === "cg") {
        const x = Math.max(0, Math.min(100, Math.round(drag.base.x - ddx / drag.sw * 100)));
        const y = Math.max(0, Math.min(100, Math.round(drag.base.y - ddy / drag.sh * 100)));
        nd[drag.field] = drag.base.z ? { x, y, z: drag.base.z } : { x, y };
        drag.el.style.backgroundPosition = `${x}% ${y}%`;
      }
    };
    const onUp = () => { if (!drag) return; drag = null; writeDraft(); renderLivePreview(); };

    stage.querySelectorAll("[data-drag-bg]").forEach((el) => el.addEventListener("pointerdown", (e) => onDown(e, "bg", null, el)));
    stage.querySelectorAll("[data-drag-cg]").forEach((el) => el.addEventListener("pointerdown", (e) => onDown(e, "cg", null, el)));
    // 立繪：水平不自由拖(由 side 下拉決定)，只允許「上下拖移」＋ ⤢ 縮放 ＋ ✕ 移除
    stage.querySelectorAll("[data-drag-portrait]").forEach((el) => el.addEventListener("pointerdown", (e) => onDown(e, "pmoveY", el.getAttribute("data-drag-portrait"), el)));
    stage.querySelectorAll("[data-resize-bg]").forEach((el) => el.addEventListener("pointerdown", (e) => onDown(e, "lresize", "bgPos", el)));
    stage.querySelectorAll("[data-resize-cg]").forEach((el) => el.addEventListener("pointerdown", (e) => onDown(e, "lresize", "cgPos", el)));
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    makeHandles();
  }

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

  // ── 預覽用音效（移植前端 sound.ts：合成音 + 檔案音，讓預覽也聽得到 SFX）──
  let _actx = null;
  function actx() {
    if (!_actx) { try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; } }
    if (_actx.state === "suspended") _actx.resume().catch(() => {});
    return _actx;
  }
  function tone(o) {
    const c = actx(); if (!c) return;
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || "triangle";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toFreq), t0 + o.dur);
    const peak = Math.max(0.0001, o.gain * 0.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(c.destination); osc.start(t0); osc.stop(t0 + o.dur + 0.02);
  }
  function noise(o) {
    const c = actx(); if (!c) return;
    const len = Math.floor(c.sampleRate * o.dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = Math.max(0.0001, o.gain * 0.6);
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = o.hp || 800;
    src.connect(hp); hp.connect(g); g.connect(c.destination); src.start();
  }
  function playPreviewSfx(key) {
    if (!key) return;
    // 武器打擊音（檔案，/sfx/hit/*）
    if (key.indexOf("hit_") === 0) { try { const a = new Audio(`/sfx/hit/${key.slice(4)}.mp3`); a.volume = 0.9; a.play().catch(() => {}); } catch (_) {} return; }
    // 檔案音效
    if (key === "chest") { try { const a = new Audio("/sfx/treasure-chest.mp3"); a.volume = 0.8; a.play().catch(() => {}); } catch (_) {} return; }
    if (key === "item") { try { const a = new Audio("/sfx/item-get.mp3"); a.volume = 0.9; a.play().catch(() => {}); } catch (_) {} return; }
    if (key === "equip") { try { const a = new Audio("/sfx/equip.mp3"); a.volume = 0.85; a.play().catch(() => {}); } catch (_) {} return; }
    // 合成音效（與前端 sound.ts playSfx 一致）
    switch (key) {
      case "hit": noise({ dur: 0.12, gain: 0.3, hp: 700 }); tone({ freq: 180, toFreq: 90, type: "square", dur: 0.1, gain: 0.12 }); break;
      case "crit": noise({ dur: 0.2, gain: 0.45, hp: 500 }); tone({ freq: 240, toFreq: 80, type: "sawtooth", dur: 0.22, gain: 0.2 }); tone({ freq: 660, toFreq: 330, type: "square", dur: 0.12, gain: 0.12, delay: 0.02 }); break;
      case "lightning": noise({ dur: 0.18, gain: 0.4, hp: 2500 }); tone({ freq: 1200, toFreq: 200, type: "sawtooth", dur: 0.18, gain: 0.12 }); break;
      case "burn": noise({ dur: 0.3, gain: 0.18, hp: 1200 }); break;
      case "freeze": tone({ freq: 1400, toFreq: 2000, type: "sine", dur: 0.25, gain: 0.12 }); tone({ freq: 1800, toFreq: 2400, type: "sine", dur: 0.2, gain: 0.08, delay: 0.04 }); break;
      case "poison": tone({ freq: 320, toFreq: 180, type: "sine", dur: 0.3, gain: 0.12 }); break;
      case "heal": tone({ freq: 520, toFreq: 780, type: "sine", dur: 0.18, gain: 0.16 }); tone({ freq: 780, toFreq: 1040, type: "sine", dur: 0.18, gain: 0.12, delay: 0.06 }); break;
      case "block": noise({ dur: 0.1, gain: 0.28, hp: 400 }); tone({ freq: 150, type: "square", dur: 0.08, gain: 0.14 }); break;
      case "dodge": tone({ freq: 900, toFreq: 1500, type: "sine", dur: 0.1, gain: 0.1 }); break;
      case "win": tone({ freq: 523, type: "triangle", dur: 0.16, gain: 0.2 }); tone({ freq: 659, type: "triangle", dur: 0.16, gain: 0.2, delay: 0.14 }); tone({ freq: 784, type: "triangle", dur: 0.28, gain: 0.2, delay: 0.28 }); break;
      case "lose": tone({ freq: 400, toFreq: 160, type: "sawtooth", dur: 0.5, gain: 0.18 }); break;
      default: break;
    }
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
      for (let i = 0; i <= upto; i++) { const n = nodes[i]; if (!n) continue; if (n.clearStage) Object.keys(st).forEach((k) => delete st[k]); if (n.exitSide === "all") Object.keys(st).forEach((k) => delete st[k]); else if (n.exitSide) delete st[n.exitSide]; if (n.type === "dialogue" && nodePortrait(n)) st[n.side || "center"] = { url: nodePortrait(n), fx: n.portraitFx }; }
      return st;
    }
    const SPEED = { slow: 2.1, normal: 1, fast: 0.45 };

    function renderNode() {
      const n = nodes[idx];
      titleEl.textContent = `${editing.title || "(未命名)"}　${idx + 1}/${nodes.length}`;
      if (!n) { stage.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c4a7f5;font-weight:900;">📖 章節結束</div>`; stopPreviewAudio(); return; }
      if (n.bgm) playPreviewBgm(n.bgm === "zone" ? zoneTrack : n.bgm);
      if (n.sfx) playPreviewSfx(n.sfx);
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
        return `<img src="${esc(p.url)}" style="position:absolute;bottom:5rem;${pos}${dim}max-height:50%;max-width:50%;object-fit:contain;animation:${anim};z-index:${speaking ? 3 : 1};">`;
      }).join("");
      const cgHtml = isCG && n.cgUrl ? `<div style="position:absolute;inset:0;background:url('${esc(n.cgUrl)}') center/cover;"></div>` : "";
      // B3:畫面效果
      const fxOverlay = n.screenFx === "flash" ? `<div style="position:absolute;inset:0;background:#fff;z-index:8;animation:stPvFlash .45s forwards;"></div>`
        : n.screenFx === "fadeblack" ? `<div style="position:absolute;inset:0;background:#000;z-index:8;animation:stPvFade .9s forwards;"></div>` : "";
      const shakeAnim = n.screenFx === "shake" ? "animation:stPvShake .4s;" : "";
      const noBox = isCG && !String(n.text || "").trim();

      stage.innerHTML = `
        <div style="position:absolute;inset:0;${shakeAnim}">
          ${bg ? `<div style="position:absolute;inset:0;background:url('${esc(bg)}') center/cover;"></div>` : ""}
          ${cgHtml}
          ${portraitsHtml}
          ${noBox ? `<div style="position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#fff;font-size:12px;">點擊繼續 ▼</div>` : `
          <div style="position:absolute;left:8px;right:8px;bottom:8px;z-index:5;padding:12px;min-height:6rem;background:linear-gradient(180deg,${isBattle ? "rgba(58,24,34,.96),rgba(24,12,20,.98)" : "rgba(30,24,58,.96),rgba(16,12,32,.98)"});border:1.5px solid ${isBattle ? "#ff5577" : "#c4a7f5"};border-radius:10px;">
            ${isBattle
              ? `<div style="text-align:center;color:#ff8a4a;font-weight:900;">⚔️ 戰鬥${n.mustWin !== false ? "（必勝）" : ""}</div><div style="text-align:center;color:#f3ecff;font-weight:900;margin-top:4px;">${esc((monsters.find((m) => m.id === n.monsterId) || {}).name || "（未選怪）")}</div><div class="hint" style="text-align:center;margin-top:6px;">（預覽不實際戰鬥）點擊繼續 ▶</div>`
              : `${isDlg ? `<div style="color:#c4a7f5;font-weight:900;font-size:14px;margin-bottom:4px;">${esc(name)}</div>` : ""}<div id="pv-text" class="${n.textFx ? "st-txt-" + esc(n.textFx) : ""}" style="color:${isDlg ? "#f3ecff" : "#cdbce8"};${isDlg ? "" : "font-style:italic;"}font-size:${n.textSize === "small" ? 12 : n.textSize === "large" ? 18 : 14}px;line-height:1.6;white-space:pre-wrap;"></div><div style="text-align:right;color:#9b8cc0;font-size:11px;margin-top:4px;">點擊繼續 ▼</div>`}
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
