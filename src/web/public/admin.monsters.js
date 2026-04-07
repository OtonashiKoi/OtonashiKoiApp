// 怪物庫管理
(function () {
  const BASE = "/admin";
  let monsters = [];
  let itemLib = [];
  let activeZone = "normal";

  const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
  const ITEM_TYPE_LABEL = { consumable: "🧪 消耗品", collectible: "🖼️ 圖片", equipment: "⚔️ 裝備", special: "✨ 特殊" };

  function apiHeaders() {
    return { "Content-Type": "application/json", Authorization: "Bearer " + (window.getAdminToken ? window.getAdminToken() : "") };
  }

  function calcStats(m) {
    const str = Number(m.str)||0, agi = Number(m.agi)||0, vit = Number(m.vit)||0;
    const INT = Number(m.int)||0, dex = Number(m.dex)||0;
    return {
      maxHp: vit*15+50, atk: str*3, def: vit*2, mdef: INT*2,
      dodge: Math.min(50, Math.round(agi*0.5*10)/10),
      hit: Math.min(100, 80+dex)
    };
  }

  function buildItemSelectOptions() {
    const groups = {};
    itemLib.forEach(i => {
      const t = i.itemType || "special";
      if (!groups[t]) groups[t] = [];
      groups[t].push(i);
    });
    return Object.entries(groups).map(([t, items]) =>
      `<optgroup label="${ITEM_TYPE_LABEL[t]||t}">${items.map(i => `<option value="${i.id}">${i.name}</option>`).join("")}</optgroup>`
    ).join("");
  }

  function buildDropsEditor(drops) {
    const rows = Array.isArray(drops) && drops.length ? drops : [];
    const opts = buildItemSelectOptions();
    const rowsHtml = rows.map(d => `
      <div class="drop-row" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
        <select class="sheet-input drop-item-sel" style="flex:1;min-width:0;">
          <option value="">-- 選道具 --</option>${opts}
        </select>
        <input class="sheet-input drop-chance" type="number" min="0" max="100" step="0.1" value="${d.chance||0}" style="width:62px;text-align:right;" />
        <span style="font-size:0.8em;color:var(--muted,#888)">%</span>
        <button type="button" class="drop-del-btn" style="background:none;border:none;color:var(--muted,#888);cursor:pointer;font-size:1.1em;padding:0 2px;" title="移除">&times;</button>
      </div>
    `).join("");
    const editor = document.createElement("div");
    editor.className = "drops-editor";
    editor.innerHTML = rowsHtml +
      `<button type="button" class="drop-add-btn button" style="padding:2px 8px;font-size:0.78em;margin-top:2px;">➕ 新增掘落</button>`;
    const sels = editor.querySelectorAll(".drop-item-sel");
    rows.forEach((d, i) => { if (sels[i]) sels[i].value = d.itemId || ""; });
    editor.querySelector(".drop-add-btn").addEventListener("click", () => {
      const div = document.createElement("div");
      div.className = "drop-row";
      div.style.cssText = "display:flex;gap:4px;align-items:center;margin-bottom:4px;";
      div.innerHTML = `
        <select class="sheet-input drop-item-sel" style="flex:1;min-width:0;">
          <option value="">-- 選道具 --</option>${buildItemSelectOptions()}
        </select>
        <input class="sheet-input drop-chance" type="number" min="0" max="100" step="0.1" value="10" style="width:62px;text-align:right;" />
        <span style="font-size:0.8em;color:var(--muted,#888)">%</span>
        <button type="button" class="drop-del-btn" style="background:none;border:none;color:var(--muted,#888);cursor:pointer;font-size:1.1em;padding:0 2px;" title="移除">&times;</button>
      `;
      editor.insertBefore(div, editor.querySelector(".drop-add-btn"));
    });
    editor.addEventListener("click", e => {
      if (e.target.classList.contains("drop-del-btn")) e.target.closest(".drop-row").remove();
    });
    return editor;
  }

  function readDropsFromEditor(td) {
    const drops = [];
    td.querySelectorAll(".drop-row").forEach(row => {
      const sel = row.querySelector(".drop-item-sel");
      const chance = parseFloat(row.querySelector(".drop-chance")?.value) || 0;
      if (!sel || !sel.value) return;
      const found = itemLib.find(i => i.id === sel.value);
      if (found) drops.push({ itemId: found.id, itemName: found.name, chance });
    });
    return drops;
  }

  //  狀態卡片 
  async function loadState() {
    const area = document.getElementById("monsters-state-area");
    if (!area) return;

    // 依分區切換狀態卡顏色
    const isMid = activeZone === "mid";
    area.style.borderColor = isMid ? "#f97316" : "var(--accent)";
    area.style.background  = isMid ? "rgba(249,115,22,0.12)" : "var(--accent-light)";

    const r = await fetch(BASE + "/monsters/state?zone=" + activeZone, { headers: apiHeaders() });
    if (!r.ok) { area.innerHTML = `<p class="hint">無法載入狀態</p>`; return; }
    const j = await r.json();
    const { state, active } = j.data || {};
    const killCount = state?.killCount || {};

    // 建立怪物選區（依 seq 排序，只顯示當前分區）
    const enabledMonsters = monsters
      .filter(m => m.enabled !== false && (m.zone || "normal") === activeZone)
      .sort((a,b) => a.seq - b.seq);
    const options = enabledMonsters.map(m => {
      const kills = killCount[m.id] || 0;
      const isActive = active && m.id === active.id;
      return `<option value="${m.seq}" ${isActive?"selected":""}>${m.seq}. ${m.name}${kills > 0 ? ` （打死 ${kills} 次）` : ""}</option>`;
    }).join("");

    const zoneLabel = isMid ? "🔥 中級區" : "⚔️ 一般區";
    const accentColor = isMid ? "#f97316" : "var(--accent,#4ade80)";

    area.innerHTML = `
      <div class="player-hero-card" style="margin-bottom:1rem;">
        <div>
          <p class="section-kicker" style="color:${accentColor};">ZONE STATUS — ${zoneLabel}</p>
          <h3 style="margin:0;">${active ? active.name : "目前沒有活躍怪物"}</h3>
          ${active ? `<p class="hint" style="margin:2px 0;">HP: ${state.currentHp ?? active.calc?.maxHp ?? "?"} / ${active.calc?.maxHp ?? "?"} &nbsp;|&nbsp; 被打死: ${killCount[active.id]||0} 次</p>` : ""}
        </div>
        ${active?.imageThumbnailUrl ? `<img src="${active.imageThumbnailUrl}" style="width:56px;height:56px;object-fit:contain;border-radius:6px;" />` : ""}
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <label style="font-size:0.88em;color:var(--muted,#aaa);">強制指定上場怪物：</label>
        <select id="monsters-zone-sel" class="sheet-input" style="width:200px;">${options.length ? options : `<option value="">請先新增怪物</option>`}</select>
        <button id="monsters-zone-switch-btn" class="button primary" style="padding:4px 14px;${isMid ? "background:#f97316;" : ""}">切換上場</button>
        <span id="monsters-zone-msg" style="font-size:0.82em;color:${accentColor};"></span>
      </div>
    `;

    document.getElementById("monsters-zone-switch-btn")?.addEventListener("click", async () => {
      const seq = Number(document.getElementById("monsters-zone-sel")?.value);
      if (!seq) return;
      const r2 = await fetch(BASE + "/monsters/state", {
        method: "PUT", headers: apiHeaders(), body: JSON.stringify({ activeMonsterSeq: seq, zone: activeZone })
      });
      const j2 = await r2.json();
      if (!r2.ok || j2.status !== "ok") {
        document.getElementById("monsters-zone-msg").textContent = "切換失敗: " + (j2.message || r2.status);
        return;
      }
      document.getElementById("monsters-zone-msg").textContent = "已切換✔";
      setTimeout(() => loadState(), 800);
    });
  }

  //  表格 
  async function loadMonsters() {
    const r = await fetch(BASE + "/monsters", { headers: apiHeaders() });
    const j = await r.json();
    monsters = Array.isArray(j.data) ? j.data : [];
    renderHead();
    renderBody();
    await loadState();
  }

  async function loadItemLib() {
    const r = await fetch(BASE + "/items", { headers: apiHeaders() });
    const j = await r.json();
    itemLib = Array.isArray(j.data) ? j.data : [];
  }

  function renderHead() {
    const head = document.getElementById("monsters-sheet-head");
    if (!head) return;
    const cols = ["出場順", "圖", "名稱", "等級", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "計算視窗", "入場費", "EXP", "金幣", "掌落道具", "出現率%", "啟用", "操作"];
    const widths = ["74px","52px","114px","82px","66px","66px","66px","66px","66px","66px","160px","86px","86px","86px","240px","70px","44px","96px"];
    head.innerHTML = "<tr>" + cols.map((c,i) => `<th style="width:${widths[i]};white-space:nowrap;">${c}</th>`).join("") + "</tr>";
  }

  function buildCalcHtml(m) {
    const c = calcStats(m);
    return `<div style="line-height:1.7;font-size:0.8em;color:var(--muted,#aaa);white-space:nowrap;">HP:${c.maxHp} ATK:${c.atk}<br>DEF:${c.def} MDEF:${c.mdef}<br>閃:${c.dodge}% 命:${c.hit}%</div>`;
  }

  function buildRow(m, isNew) {
    const tr = document.createElement("tr");
    tr.style.verticalAlign = "top";
    tr.dataset.id = m.id || "";
    tr.dataset.isNew = isNew ? "1" : "0";

    const imgSrc = m.imageThumbnailUrl || m.imageUrl || "";
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" style="width:40px;height:40px;object-fit:contain;border-radius:4px;cursor:pointer;" class="monster-img-preview" />`
      : `<span style="font-size:1.4em;cursor:pointer;line-height:40px;" class="monster-img-preview">➕</span>`;

    const statsInputs = STAT_KEYS.map(k =>
      `<td style="padding:6px 4px;"><input class="sheet-input stat-input" data-stat="${k}" type="number" min="0" step="1" value="${m[k]??1}" style="width:58px;text-align:center;" /></td>`
    ).join("");

    const enabled = m.enabled !== false;
    const seq = m.seq || 1;

    tr.innerHTML = `
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="seq" type="number" min="1" step="1" value="${seq}" style="width:62px;text-align:center;${!enabled ? 'opacity:0.35;pointer-events:none;' : ''}" ${!enabled ? 'disabled' : ''} /></td>
      <td style="padding:6px;" class="img-cell">${imgHtml}</td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="name" type="text" value="${(m.name||"").replace(/"/g,"&quot;")}" style="width:104px;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="level" type="number" min="0" max="15" step="1" value="${m.level ?? 1}" style="width:72px;text-align:center;" /></td>
      ${statsInputs}
      <td class="calc-cell" style="padding:6px 8px;">${buildCalcHtml(m)}</td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="entryFee" type="number" min="0" value="${m.entryFee||0}" style="width:76px;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="expReward" type="number" min="0" value="${m.expReward||0}" style="width:76px;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="goldReward" type="number" min="0" value="${m.goldReward||0}" style="width:76px;" /></td>
      <td class="drops-td" style="padding:6px 4px;"></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="spawnRate" type="number" min="1" max="100" step="1" value="${m.spawnRate ?? 10}" style="width:60px;text-align:center;" /></td>
      <td style="padding:8px 4px;text-align:center;"><input type="checkbox" data-field="enabled" ${enabled ? "checked" : ""} /></td>
      <td style="padding:6px 4px;white-space:nowrap;">
        <button class="button primary btn-save" style="padding:3px 10px;font-size:0.8em;">儲存</button>
        <button class="button btn-delete" style="padding:3px 8px;font-size:0.8em;margin-left:4px;">刪除</button>
      </td>
    `;
    tr.querySelector(".drops-td").appendChild(buildDropsEditor(m.drops || []));
    return tr;
  }

  function renderBody() {
    const tbody = document.getElementById("monsters-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    monsters.filter(m => (m.zone || "normal") === activeZone).forEach(m => tbody.appendChild(buildRow(m, false)));
    bindTableEvents(tbody);
  }

  function updateCalc(tr) {
    const stats = {};
    tr.querySelectorAll(".stat-input").forEach(inp => { stats[inp.dataset.stat] = Number(inp.value)||0; });
    const cell = tr.querySelector(".calc-cell");
    if (cell) cell.innerHTML = buildCalcHtml(stats);
  }

  function bindTableEvents(tbody) {
    tbody.addEventListener("input", function (e) {
      if (e.target.classList.contains("stat-input")) updateCalc(e.target.closest("tr"));
    });
    tbody.addEventListener("click", async function (e) {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      if (e.target.classList.contains("btn-save")) { await saveRow(tr); }
      else if (e.target.classList.contains("btn-delete")) {
        const id = tr.dataset.id;
        const name = tr.querySelector("[data-field=name]")?.value || id;
        if (!confirm(`刪除怎物「${name}」？`)) return;
        await deleteMonster(id);
      } else if (e.target.closest(".monster-img-preview")) {
        const id = tr.dataset.id;
        if (!id || tr.dataset.isNew === "1") { alert("請先儲存怪物再上傳圖片"); return; }
        pendingImgRowId = id;
        document.getElementById("monsters-img-input")?.click();
      }
    });
  }

  function getPayload(tr) {
    const stats = {};
    tr.querySelectorAll(".stat-input").forEach(inp => { stats[inp.dataset.stat] = inp.value === "" ? 0 : (Number(inp.value) ?? 0); });
    const dropsTd = tr.querySelector(".drops-td");
    return {
      seq: Number(tr.querySelector("[data-field=seq]")?.value) || 1,
      name: tr.querySelector("[data-field=name]")?.value || "",
      zone: activeZone,
      level: Number(tr.querySelector("[data-field=level]")?.value) ?? 1,
      ...stats,
      entryFee: Number(tr.querySelector("[data-field=entryFee]")?.value) || 0,
      expReward: Number(tr.querySelector("[data-field=expReward]")?.value) || 0,
      goldReward: Number(tr.querySelector("[data-field=goldReward]")?.value) || 0,
      drops: dropsTd ? readDropsFromEditor(dropsTd) : [],
      spawnRate: Number(tr.querySelector("[data-field=spawnRate]")?.value) || 10,
      enabled: tr.querySelector("[data-field=enabled]")?.checked || false
    };
  }

  async function saveRow(tr) {
    const payload = getPayload(tr);
    const id = tr.dataset.id;
    const isNew = tr.dataset.isNew === "1";
    const url = isNew ? BASE + "/monsters" : BASE + "/monsters/" + id;
    const method = isNew ? "POST" : "PUT";
    const r = await fetch(url, { method, headers: apiHeaders(), body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok || j.status !== "ok") { alert("儲存失敗: " + (j.message || r.status)); return; }
    await loadMonsters();
  }

  async function deleteMonster(id) {
    if (!id) return;
    const r = await fetch(BASE + "/monsters/" + id, { method: "DELETE", headers: apiHeaders() });
    const j = await r.json();
    if (!r.ok || j.status !== "ok") { alert("刪除失敗: " + (j.message || r.status)); return; }
    await loadMonsters();
  }

  function addNewRow() {
    const tbody = document.getElementById("monsters-tbody");
    if (!tbody) return;
    const nextSeq = monsters.length ? Math.max(...monsters.map(m => m.seq||1)) + 1 : 1;
    const blank = { id: "", seq: nextSeq, name: "", zone: activeZone, level: 1, str:5, agi:5, vit:5, int:5, dex:5, luk:5, entryFee:100, expReward:50, goldReward:30, spawnRate:10, drops:[], enabled:true };
    const tr = buildRow(blank, true);
    tbody.appendChild(tr);
    bindTableEvents(tr.parentElement);
    tr.querySelector("[data-field=name]")?.focus();
  }

  let pendingImgRowId = null;

  function initImageUpload() {
    const imgInput = document.getElementById("monsters-img-input");
    if (!imgInput) return;
    imgInput.addEventListener("change", async function () {
      if (!this.files[0] || !pendingImgRowId) return;
      const rowId = pendingImgRowId;
      const form = new FormData();
      form.append("image", this.files[0]);
      this.value = ""; pendingImgRowId = null;
      const r = await fetch(BASE + "/monsters/" + rowId + "/image", {
        method: "POST", headers: { Authorization: "Bearer " + (window.getAdminToken ? window.getAdminToken() : "") }, body: form
      });
      if (!r.ok) { alert("圖片上傳失敗"); return; }
      const json = await r.json();
      const thumb = json.data?.imageThumbnailUrl || json.data?.imageUrl;
      if (thumb) {
        const tr = document.querySelector(`tr[data-id="${rowId}"]`);
        const cell = tr?.querySelector(".img-cell");
        if (cell) cell.innerHTML = `<img src="${thumb}" style="width:40px;height:40px;object-fit:contain;border-radius:4px;cursor:pointer;" class="monster-img-preview" />`;
      }
    });
  }

  function initZoneTabs() {
    const tabs = document.querySelectorAll(".monsters-zone-tab");
    function updateTabStyles() {
      tabs.forEach(btn => {
        const isActive = btn.dataset.zone === activeZone;
        btn.style.color = isActive ? "var(--text,#e8e8e8)" : "var(--muted,#888)";
        btn.style.borderBottomColor = isActive ? "var(--accent,#4ade80)" : "transparent";
        btn.style.fontWeight = isActive ? "600" : "400";
      });
    }
    tabs.forEach(btn => {
      btn.addEventListener("click", function () {
        activeZone = this.dataset.zone;
        updateTabStyles();
        renderBody();
        loadState();
      });
    });
    updateTabStyles();
  }

  document.addEventListener("adminConnected", async () => {
    await loadItemLib();
    await loadMonsters();
    initImageUpload();
    initZoneTabs();
    document.getElementById("monsters-btn-new")?.addEventListener("click", addNewRow);
  });
})();
