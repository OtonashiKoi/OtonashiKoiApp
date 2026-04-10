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

  // 僅計算衍生數值（ATK/dodge/hit），HP/DEF 由輸入框直接決定
  function calcDerived(m) {
    const str = Number(m.str) || 0, agi = Number(m.agi) || 0;
    const dex = Number(m.dex) || 0;
    return {
      atk:   str * 3,
      dodge: Math.min(50, Math.round(agi * 0.5 * 10) / 10),
      hit:   Math.min(100, 80 + dex)
    };
  }

  // 建議 exp/gold（5人×3次，僅用於 placeholder，不覆蓋輸入值）
  function suggestRewards(maxHp, level, atk) {
    const exp  = Math.max(1, Math.round(maxHp / 15 * 1.2 + level * 50 + atk * 8));
    const gold = Math.max(1, Math.round(exp * 0.82));
    return { exp, gold };
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

  function getItemThumb(id) {
    const item = itemLib.find(i => i.id === id);
    return item ? (item.imageThumbnailUrl || item.imageUrl || "") : "";
  }

  /* ── 搜尋式 combobox（取代原生 select） ── */
  function makeItemCombobox(selectedItemId = "") {
    const selectedItem = itemLib.find(i => i.id === selectedItemId) || null;

    const wrap = document.createElement("div");
    wrap.className = "drop-combo-wrap";
    wrap.style.cssText = "position:relative;flex:1;min-width:0;";

    // 隱藏 value 欄
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.className = "drop-item-sel";
    hidden.value = selectedItemId;

    // 顯示用輸入框
    const display = document.createElement("input");
    display.type = "text";
    display.className = "sheet-input drop-combo-display";
    display.placeholder = "🔍 搜尋道具...";
    display.autocomplete = "off";
    display.spellcheck = false;
    display.style.cssText = "width:100%;cursor:pointer;";
    display.value = selectedItem ? `${ITEM_TYPE_LABEL[selectedItem.itemType] || ""} ${selectedItem.name}` : "";

    // 下拉面板
    const panel = document.createElement("div");
    panel.className = "drop-combo-panel";
    panel.style.cssText = [
      "display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:999;",
      "background:var(--surface);border:1px solid var(--accent);border-radius:6px;",
      "max-height:240px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.7),0 0 0 1px var(--accent-glow);",
    ].join("");

    function renderList(keyword) {
      panel.innerHTML = "";
      const kw = (keyword || "").trim().toLowerCase();
      const filtered = kw
        ? itemLib.filter(i => i.name.toLowerCase().includes(kw) || (i.itemType || "").toLowerCase().includes(kw))
        : itemLib;

      if (!filtered.length) {
        panel.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:12px;text-align:center;">找不到道具</div>`;
        return;
      }

      // 依類型分組顯示
      const groups = {};
      filtered.forEach(i => {
        const t = i.itemType || "special";
        if (!groups[t]) groups[t] = [];
        groups[t].push(i);
      });

      Object.entries(groups).forEach(([t, items]) => {
        const header = document.createElement("div");
        header.style.cssText = "padding:6px 10px 3px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;font-family:var(--font-display);border-top:1px solid var(--line);";
        header.textContent = (ITEM_TYPE_LABEL[t] || t).replace(/^[^\s]+\s/, ""); // 去掉 emoji
        panel.appendChild(header);

        items.forEach(item => {
          const row = document.createElement("div");
          row.className = "drop-combo-item";
          row.dataset.itemId = item.id;
          row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px;transition:background 0.1s;";

          const thumb = item.imageThumbnailUrl || item.imageUrl || "";
          const typeColor = {
            consumable: "var(--success)", equipment: "var(--accent)",
            collectible: "var(--gold)", special: "var(--pink)"
          }[t] || "var(--muted)";

          row.innerHTML = `
            ${thumb ? `<img src="${thumb}" style="width:20px;height:20px;object-fit:contain;border-radius:3px;flex-shrink:0;" />` : `<span style="width:20px;height:20px;flex-shrink:0;"></span>`}
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</span>
            <span style="font-size:10px;color:${typeColor};flex-shrink:0;font-family:var(--font-display);letter-spacing:0.05em;">${t}</span>
          `;

          if (item.id === hidden.value) row.style.background = "var(--accent-light)";

          row.addEventListener("mouseenter", () => row.style.background = "var(--surface-hover)");
          row.addEventListener("mouseleave", () => row.style.background = item.id === hidden.value ? "var(--accent-light)" : "");
          row.addEventListener("mousedown", e => {
            e.preventDefault(); // 避免 display blur 先觸發
            selectItem(item);
          });
          panel.appendChild(row);
        });
      });
    }

    function selectItem(item) {
      hidden.value = item.id;
      display.value = `${ITEM_TYPE_LABEL[item.itemType] || ""} ${item.name}`;
      // 更新縮圖
      const thumb = wrap.previousElementSibling;
      if (thumb && thumb.classList.contains("drop-thumb")) {
        const src = item.imageThumbnailUrl || item.imageUrl || "";
        if (src) { thumb.src = src; thumb.style.display = ""; }
        else { thumb.src = ""; thumb.style.display = "none"; }
      }
      closePanel();
    }

    function clearItem() {
      hidden.value = "";
      const thumb = wrap.previousElementSibling;
      if (thumb && thumb.classList.contains("drop-thumb")) { thumb.src = ""; thumb.style.display = "none"; }
    }

    function openPanel() {
      renderList(display.value === (itemLib.find(i => i.id === hidden.value)?.name || "") ? "" : display.value);
      panel.style.display = "block";
      display.select();
    }

    function closePanel() { panel.style.display = "none"; }

    display.addEventListener("focus", () => {
      // 點擊時清空 display 以進入搜尋模式
      if (hidden.value) display.value = "";
      openPanel();
    });
    display.addEventListener("blur", () => {
      // 若沒選，還原為目前 value
      setTimeout(() => {
        if (panel.style.display === "block") return;
        const cur = itemLib.find(i => i.id === hidden.value);
        display.value = cur ? `${ITEM_TYPE_LABEL[cur.itemType] || ""} ${cur.name}` : "";
        if (!hidden.value) clearItem();
      }, 150);
    });
    display.addEventListener("input", () => {
      renderList(display.value);
      panel.style.display = "block";
      if (!display.value) clearItem();
    });
    display.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closePanel();
        const cur = itemLib.find(i => i.id === hidden.value);
        display.value = cur ? `${ITEM_TYPE_LABEL[cur.itemType] || ""} ${cur.name}` : "";
      }
    });

    // 點擊面板外關閉
    document.addEventListener("click", e => {
      if (!wrap.contains(e.target)) closePanel();
    }, { capture: true });

    wrap.append(hidden, display, panel);
    return wrap;
  }

  /* ===== 全域的 道具選擇 Modal (可傳回選取結果及機率) ===== */
  function getItemPickerModal() {
    // singleton
    let modal = document.getElementById("drop-item-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "drop-item-modal";
    modal.style.cssText = [
      "display:none;position:fixed;inset:0;z-index:2000;",
      "background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;",
      "padding:24px;",
    ].join("");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "width:920px;max-width:100%;max-height:86vh;overflow:auto;border-radius:8px;",
      "background:var(--surface);border:1px solid var(--accent);padding:14px;box-shadow:0 8px 32px rgba(0,0,0,0.6);",
    ].join("");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";
    header.innerHTML = `<strong style=\"font-size:1rem;\">選擇掉落道具</strong>`;

    const rightControls = document.createElement("div");
    rightControls.style.cssText = "display:flex;gap:8px;align-items:center;";
    const chanceLabel = document.createElement("label");
    chanceLabel.style.cssText = "font-size:0.85rem;color:var(--muted);";
    chanceLabel.textContent = "掉落機率：";
    const chanceInput = document.createElement("input");
    chanceInput.type = "number"; chanceInput.min = 0; chanceInput.max = 100; chanceInput.step = 0.1; chanceInput.value = 10;
    chanceInput.style.cssText = "width:86px;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);";
    const closeBtn = document.createElement("button");
    closeBtn.className = "button"; closeBtn.textContent = "關閉";
    closeBtn.addEventListener("click", () => { modal.style.display = "none"; modal._cb = null; });

    rightControls.append(chanceLabel, chanceInput, closeBtn);
    header.appendChild(rightControls);

    const content = document.createElement("div");
    content.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;";

    // 類別篩選器（All / consumable / collectible / equipment / special）
    const categorySelect = document.createElement("select");
    categorySelect.style.cssText = "margin-left:8px;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);";
    const catOpts = [{v:"",t:"全部"}].concat(Object.keys(ITEM_TYPE_LABEL).map(k => ({ v: k, t: (ITEM_TYPE_LABEL[k]||k).replace(/^[^\s]+\s/, "") })));
    catOpts.forEach(o => categorySelect.appendChild(new Option(o.t, o.v)));
    // 裝備次分類（動態產生，僅在選擇 equipment 時顯示）
    const equipmentSelect = document.createElement("select");
    equipmentSelect.style.cssText = "margin-left:8px;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);display:none;";
    equipmentSelect.addEventListener('change', () => renderItems(search.value));

    function getEquipSubtype(it) {
      return it.slot || it.subType || it.equipType || it.category || it.type || '其他';
    }

    function populateEquipSubtypes() {
      const set = new Set();
      itemLib.forEach(i => { if ((i.itemType||'') === 'equipment') set.add(getEquipSubtype(i)); });
      const arr = Array.from(set).filter(Boolean).sort();
      equipmentSelect.innerHTML = '';
      equipmentSelect.appendChild(new Option('全部裝備', ''));
      arr.forEach(v => equipmentSelect.appendChild(new Option(v, v)));
    }

    categorySelect.addEventListener("change", () => {
      equipmentSelect.style.display = categorySelect.value === 'equipment' ? '' : 'none';
      populateEquipSubtypes();
      renderItems(search.value);
    });

    // 數值摘要：針對常見屬性顯示中文標籤（僅顯示有數值的欄位），若無則回傳 id
    function formatItemStats(it) {
      if (!it || typeof it !== 'object') return "";
      const mapping = { atk: '攻', def: '防', mdef: '魔防', str: 'STR', agi: 'AGI', vit: 'VIT', int: 'INT', dex: 'DEX', luk: 'LUK' };
      const parts = [];
      Object.keys(mapping).forEach(k => {
        if (typeof it[k] === 'number' && !isNaN(it[k])) parts.push(`${mapping[k]}:${it[k]}`);
      });
      if (parts.length) return parts.join(' ');
      // fallback: show some id or short descriptor
      return it.id || "";
    }

    // render function
    function renderItems(filter) {
      content.innerHTML = "";
      const kw = (filter||"").trim().toLowerCase();
      const selCat = categorySelect.value || "";
      const filtered = kw ? itemLib.filter(i => i.name.toLowerCase().includes(kw) || (i.itemType||"").toLowerCase().includes(kw)) : itemLib;
      // 若選了類別，先過濾
      const filteredByCat = selCat ? filtered.filter(i => (i.itemType||'') === selCat) : filtered;
      // 若為裝備並有次分類選擇，進一步過濾
      const equipSub = (typeof equipmentSelect !== 'undefined') ? (equipmentSelect.value || '') : '';
      const finalFiltered = (selCat === 'equipment' && equipSub) ? filteredByCat.filter(i => getEquipSubtype(i) === equipSub) : filteredByCat;
      const groups = {};
      finalFiltered.forEach(i => { const t = i.itemType||"special"; if (!groups[t]) groups[t]=[]; groups[t].push(i); });

      Object.entries(groups).forEach(([t, items]) => {
        const gwrap = document.createElement("div");
        // 裝備類改用多欄 Grid 顯示以利快速瀏覽；其他類別維持直列
        if (t === 'equipment') gwrap.style.cssText = "flex:1 1 280px;min-width:240px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;";
        else gwrap.style.cssText = "flex:1 1 220px;min-width:200px;";
        const ghead = document.createElement("div");
        ghead.style.cssText = "font-size:0.8rem;color:var(--muted);font-weight:700;margin-bottom:6px;";
        ghead.textContent = (ITEM_TYPE_LABEL[t]||t).replace(/^[^\s]+\s/, "");
        gwrap.appendChild(ghead);

        items.forEach(it => {
          const card = document.createElement("div");
          // 裝備卡片改小尺寸以適合 Grid
          card.style.cssText = t === 'equipment' ? "display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:6px;cursor:pointer;" : "display:flex;align-items:center;gap:8px;padding:6px;border-radius:6px;cursor:pointer;margin-bottom:6px;";
          card.addEventListener("mouseenter", () => card.style.background = "var(--surface-hover)");
          card.addEventListener("mouseleave", () => card.style.background = "");
          const thumb = it.imageThumbnailUrl || it.imageUrl || "";
          // 裝備類顯示數值摘要（中文標籤）；其他類別顯示 id
          const infoLine = (it.itemType === 'equipment') ? formatItemStats(it) : it.id;
          card.innerHTML = `${thumb?`<img src=\"${thumb}\" style=\"width:36px;height:36px;object-fit:contain;border-radius:6px;\"/>`:`<span style=\"width:36px;height:36px;display:inline-block;\"></span>`}<div style=\"flex:1;overflow:hidden;\"><div style=\"font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\">${it.name}</div><div style=\"font-size:0.8rem;color:var(--muted);\">${infoLine}</div></div>`;
          card.addEventListener("click", () => {
            if (typeof modal._cb === "function") {
              const c = parseFloat(chanceInput.value) || 0;
              modal._cb(it, c);
            }
            modal.style.display = "none";
            modal._cb = null;
          });
          gwrap.appendChild(card);
        });

        content.appendChild(gwrap);
      });
    }

    const search = document.createElement("input");
    search.type = "text"; search.placeholder = "🔍 搜尋道具...";
    search.style.cssText = "width:100%;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--line);";
    search.addEventListener("input", () => renderItems(search.value));

    panel.append(header, categorySelect, equipmentSelect, search, content);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    // expose open API
    modal.open = function ({ currentItemId = "", currentChance = 10, cb = null } = {}) {
      modal._cb = cb;
      chanceInput.value = currentChance;
      search.value = "";
      renderItems("");
      modal.style.display = "flex";
    };

    return modal;
  }

  function makeDropRow(itemId = "", chance = 10) {
    const div = document.createElement("div");
    div.className = "drop-row";
    div.style.cssText = "display:flex;gap:4px;align-items:center;margin-bottom:4px;";

    const thumbSrc = getItemThumb(itemId);
    const thumb = document.createElement("img");
    thumb.className = "drop-thumb";
    thumb.style.cssText = `width:22px;height:22px;object-fit:contain;border-radius:3px;flex-shrink:0;${thumbSrc ? "" : "display:none;"}`;
    if (thumbSrc) thumb.src = thumbSrc;

    const combo = makeItemCombobox(itemId);

    // modal 快捷按鈕（開啟分類視窗選取）
    const modalBtn = document.createElement("button");
    modalBtn.type = "button";
    modalBtn.className = "drop-modal-btn button";
    modalBtn.title = "更多選擇...";
    modalBtn.textContent = "⋯";
    modalBtn.style.cssText = "padding:6px 8px;margin-left:6px;border-radius:6px;flex-shrink:0;";
    modalBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const hiddenInput = combo.querySelector(".drop-item-sel");
      const displayInput = combo.querySelector(".drop-combo-display");
      const modal = getItemPickerModal();
      modal.open({ currentItemId: hiddenInput?.value || "", currentChance: Number(chanceInput.value) || 0, cb: (item, c) => {
        if (!hiddenInput) return;
        hiddenInput.value = item.id;
        if (displayInput) displayInput.value = `${ITEM_TYPE_LABEL[item.itemType] || ""} ${item.name}`;
        const src = item.imageThumbnailUrl || item.imageUrl || "";
        if (src) { thumb.src = src; thumb.style.display = ""; } else { thumb.src = ""; thumb.style.display = "none"; }
        chanceInput.value = c;
      } });
    });

    const chanceInput = document.createElement("input");
    chanceInput.type = "number";
    chanceInput.className = "sheet-input drop-chance";
    chanceInput.min = 0; chanceInput.max = 100; chanceInput.step = 0.1;
    chanceInput.value = chance;
    chanceInput.style.cssText = "width:62px;text-align:right;flex-shrink:0;";

    const pct = document.createElement("span");
    pct.style.cssText = "font-size:0.8em;color:var(--muted);flex-shrink:0;";
    pct.textContent = "%";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "drop-del-btn";
    delBtn.style.cssText = "background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1em;padding:0 2px;flex-shrink:0;";
    delBtn.title = "移除";
    delBtn.textContent = "×";

    div.append(thumb, combo, modalBtn, chanceInput, pct, delBtn);
    return div;
  }

  function buildDropsEditor(drops) {
    const rows = Array.isArray(drops) && drops.length ? drops : [];
    const editor = document.createElement("div");
    editor.className = "drops-editor";
    rows.forEach(d => editor.appendChild(makeDropRow(d.itemId || "", d.chance || 0)));
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "drop-add-btn button";
    addBtn.style.cssText = "padding:2px 8px;font-size:0.78em;margin-top:2px;";
    addBtn.textContent = "➕ 新增掘落";
    editor.appendChild(addBtn);
    addBtn.addEventListener("click", () => editor.insertBefore(makeDropRow(), addBtn));
    editor.addEventListener("click", e => {
      if (e.target.classList.contains("drop-del-btn")) e.target.closest(".drop-row").remove();
    });
    return editor;
  }

  function readDropsFromEditor(td) {
    const drops = [];
    td.querySelectorAll(".drop-row").forEach(row => {
      const hidden = row.querySelector(".drop-item-sel");
      const chance = parseFloat(row.querySelector(".drop-chance")?.value) || 0;
      if (!hidden || !hidden.value) return;
      const found = itemLib.find(i => i.id === hidden.value);
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
    const cols = ["出場順", "圖", "名稱", "等級", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "MaxHP", "DEF", "衍生數值", "入場費", "EXP", "金幣", "掌落道具", "出現率%", "BOSS", "啟用", "操作"];
    const widths = ["74px","52px","114px","82px","66px","66px","66px","66px","66px","66px","90px","90px","120px","86px","86px","86px","240px","70px","50px","44px","96px"];
    head.innerHTML = "<tr>" + cols.map((c,i) => `<th style="width:${widths[i]};white-space:nowrap;">${c}</th>`).join("") + "</tr>";
  }

  function buildCalcHtml(m) {
    const d = calcDerived(m);
    const defPct = Math.min(75, Number(m.def) || 0);
    const effAtk = Math.round(d.atk * (1 - defPct / 100));
    return `<div style="line-height:1.7;font-size:0.8em;color:var(--muted,#aaa);white-space:nowrap;">ATK:${d.atk} DEF:${defPct}%<br>玩家實傷≈${effAtk} 閃:${d.dodge}%</div>`;
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

    // 計算 exp/gold 建議值作為 placeholder
    const maxHp = Number(m.maxHp) || 0;
    const level = Number(m.level) || 1;
    const atk = (Number(m.str) || 0) * 3;
    const sg = suggestRewards(maxHp, level, atk);

    tr.innerHTML = `
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="seq" type="number" min="1" step="1" value="${seq}" style="width:62px;text-align:center;${!enabled ? 'opacity:0.35;pointer-events:none;' : ''}" ${!enabled ? 'disabled' : ''} /></td>
      <td style="padding:6px;" class="img-cell">${imgHtml}</td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="name" type="text" value="${(m.name||"").replace(/"/g,"&quot;")}" style="width:104px;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="level" type="number" min="0" max="15" step="1" value="${m.level ?? 1}" style="width:72px;text-align:center;" /></td>
      ${statsInputs}
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="maxHp" type="number" min="1" value="${m.maxHp||1}" style="width:82px;text-align:center;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="def" type="number" min="0" max="75" value="${m.def||0}" style="width:82px;text-align:center;" /></td>
      <td class="calc-cell" style="padding:6px 8px;">${buildCalcHtml(m)}</td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="entryFee" type="number" min="0" value="${m.entryFee||0}" style="width:76px;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="expReward" type="number" min="0" value="${m.expReward||0}" placeholder="建議:${sg.exp}" style="width:76px;" /></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="goldReward" type="number" min="0" value="${m.goldReward||0}" placeholder="建議:${sg.gold}" style="width:76px;" /></td>
      <td class="drops-td" style="padding:6px 4px;"></td>
      <td style="padding:6px 4px;"><input class="sheet-input" data-field="spawnRate" type="number" min="1" max="100" step="1" value="${m.spawnRate ?? 10}" style="width:60px;text-align:center;" /></td>
      <td style="padding:8px 4px;text-align:center;"><input type="checkbox" data-field="isBoss" title="BOSS 出場時發送廣播" ${m.isBoss ? "checked" : ""} /></td>
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
    const oldTbody = document.getElementById("monsters-tbody");
    if (!oldTbody) return;
    // 用 clone 替換，清除所有累積的 event listener，避免重複觸發
    const tbody = oldTbody.cloneNode(false);
    oldTbody.replaceWith(tbody);
    monsters.filter(m => (m.zone || "normal") === activeZone).forEach(m => tbody.appendChild(buildRow(m, false)));
    bindTableEvents(tbody);
  }

  function updateCalc(tr) {
    const stats = {};
    tr.querySelectorAll(".stat-input").forEach(inp => { stats[inp.dataset.stat] = Number(inp.value)||0; });
    stats.def = Number(tr.querySelector("[data-field=def]")?.value) || 0;
    const cell = tr.querySelector(".calc-cell");
    if (cell) cell.innerHTML = buildCalcHtml(stats);
    // 更新 exp/gold 的建議 placeholder
    const maxHp  = Number(tr.querySelector("[data-field=maxHp]")?.value) || 0;
    const level  = Number(tr.querySelector("[data-field=level]")?.value) || 1;
    const atk    = (Number(stats.str) || 0) * 3;
    const sg = suggestRewards(maxHp, level, atk);
    const expInput  = tr.querySelector("[data-field=expReward]");
    const goldInput = tr.querySelector("[data-field=goldReward]");
    if (expInput)  expInput.placeholder  = `建議:${sg.exp}`;
    if (goldInput) goldInput.placeholder = `建議:${sg.gold}`;
  }

  function bindTableEvents(tbody) {
    tbody.addEventListener("input", function (e) {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      if (e.target.classList.contains("stat-input") || ["maxHp","def","level"].includes(e.target.dataset.field)) {
        updateCalc(tr);
      }
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
      seq:        Number(tr.querySelector("[data-field=seq]")?.value)       || 1,
      name:              tr.querySelector("[data-field=name]")?.value       || "",
      zone:        activeZone,
      level:      Number(tr.querySelector("[data-field=level]")?.value)     ?? 1,
      ...stats,
      maxHp:      Number(tr.querySelector("[data-field=maxHp]")?.value)     || 1,
      def:        Number(tr.querySelector("[data-field=def]")?.value)       || 0,
      entryFee:   Number(tr.querySelector("[data-field=entryFee]")?.value)  || 0,
      expReward:  Number(tr.querySelector("[data-field=expReward]")?.value) || 0,
      goldReward: Number(tr.querySelector("[data-field=goldReward]")?.value)|| 0,
      drops:      dropsTd ? readDropsFromEditor(dropsTd) : [],
      spawnRate:  Number(tr.querySelector("[data-field=spawnRate]")?.value) || 10,
      isBoss:            tr.querySelector("[data-field=isBoss]")?.checked   || false,
      enabled:           tr.querySelector("[data-field=enabled]")?.checked  || false
    };
  }

  async function saveRow(tr) {
    if (tr.dataset.saving === "1") return;
    tr.dataset.saving = "1";
    try {
      const payload = getPayload(tr);
      const id = tr.dataset.id;
      const isNew = tr.dataset.isNew === "1";
      const url = isNew ? BASE + "/monsters" : BASE + "/monsters/" + id;
      const method = isNew ? "POST" : "PUT";
      const r = await fetch(url, { method, headers: apiHeaders(), body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok || j.status !== "ok") { alert("儲存失敗: " + (j.message || r.status)); return; }
      await loadMonsters();
    } catch (err) {
      alert("儲存發生錯誤: " + err.message);
    } finally {
      tr.dataset.saving = "0";
    }
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
    const blank = { id: "", seq: nextSeq, name: "", zone: activeZone, level: 1, str:5, agi:5, vit:5, int:5, dex:5, luk:5, maxHp:1000, def:50, entryFee:0, expReward:0, goldReward:0, spawnRate:10, isBoss:false, drops:[], enabled:true };
    const tr = buildRow(blank, true);
    tbody.appendChild(tr);
    // 不重新 bind，新 row 的事件會 bubble 到已綁定的 tbody listener
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
