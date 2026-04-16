// 怪物庫管理
(function () {
  const BASE = "/admin";
  let monsters = [];
  let itemLib = [];
  let activeZone = "normal";
  let zoneState = {};
  let npcTemplates = [];

  const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
  const ITEM_TYPE_LABEL = { consumable: "🧪 消耗品", collectible: "🖼️ 圖片", equipment: "⚔️ 裝備", job_badge: "📖 職業徽章", monster_card: "🎴 卡片", special: "✨ 特殊" };

  function apiHeaders() {
    return { "Content-Type": "application/json", Authorization: "Bearer " + (window.getAdminToken ? window.getAdminToken() : "") };
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
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

  function getNpcTemplate(id) {
    return npcTemplates.find((tpl) => tpl.id === id) || null;
  }

  async function loadNpcTemplates() {
    const r = await fetch(BASE + "/monster-events?includeDisabled=1", { headers: apiHeaders() });
    const j = await r.json();
    npcTemplates = Array.isArray(j.data) ? j.data : [];
  }

  function normalizeNpcEncounter(entry = {}, index = 0) {
    const eventId = String(entry.eventId || entry.id || "").trim();
    const chance = Math.max(0, Math.min(100, Number(entry.chance) || 0));
    const triggerMonsterSeq = entry.triggerMonsterSeq == null || entry.triggerMonsterSeq === ""
      ? null
      : Number(entry.triggerMonsterSeq);
    return {
      eventId,
      chance,
      triggerMonsterSeq: Number.isFinite(triggerMonsterSeq) && triggerMonsterSeq > 0 ? Math.floor(triggerMonsterSeq) : null,
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : index
    };
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
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.65);align-items:center;justify-content:center;padding:16px;";

    const panel = document.createElement("div");
    panel.style.cssText = [
      "width:1100px;max-width:98vw;height:88vh;display:flex;flex-direction:column;",
      "border-radius:10px;background:var(--surface);border:1px solid var(--accent);",
      "padding:16px;box-shadow:0 8px 40px rgba(0,0,0,0.7);overflow:hidden;",
    ].join("");

    // ── Header ──
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-shrink:0;";
    header.innerHTML = `<strong style="font-size:1rem;">選擇掉落道具</strong>`;
    const rightControls = document.createElement("div");
    rightControls.style.cssText = "display:flex;gap:8px;align-items:center;";
    const chanceLabel = document.createElement("label");
    chanceLabel.style.cssText = "font-size:0.85rem;color:var(--muted);";
    chanceLabel.textContent = "掉落機率：";
    const chanceInput = document.createElement("input");
    chanceInput.type = "number"; chanceInput.min = 0; chanceInput.max = 100; chanceInput.step = 0.1; chanceInput.value = 10;
    chanceInput.style.cssText = "width:80px;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);";
    const closeBtn = document.createElement("button");
    closeBtn.className = "button"; closeBtn.textContent = "關閉";
    closeBtn.addEventListener("click", () => { modal.style.display = "none"; modal._cb = null; });
    rightControls.append(chanceLabel, chanceInput, closeBtn);
    header.appendChild(rightControls);

    // ── 搜尋欄 ──
    const search = document.createElement("input");
    search.type = "text"; search.placeholder = "🔍 搜尋道具...";
    search.style.cssText = "width:100%;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--line);background:var(--bg);flex-shrink:0;box-sizing:border-box;";

    // ── Tab 列 ──
    const TABS = [
      { key: "all",        label: "全部" },
      { key: "weapon",     label: "⚔️ 武器" },
      { key: "defense",    label: "🛡️ 防具/盾" },
      { key: "head",       label: "🪖 頭部" },
      { key: "accessory",  label: "💍 飾品" },
      { key: "consumable", label: "🧪 消耗品" },
      { key: "collectible",label: "📦 收藏品" },
      { key: "job_badge",  label: "📖 職業徽章" },
      { key: "monster_card",label: "🎴 卡片" },
    ];
    const WEAPON_TYPE_LABELS = {
      sword_1h:'劍(單)', sword_2h:'劍(雙)',
      mace_1h:'鎚(單)', mace_2h:'鎚(雙)',
      axe_1h:'斧(單)',  axe_2h:'斧(雙)',
      dagger:'匕首',
      staff_1h:'杖(單)', staff_2h:'杖(雙)',
      bow:'弓',
    };
    const TIER_COLORS = { D:'#8899aa', C:'#44cc88', B:'#6699ff', A:'#ffcc44' };

    let activeTab = "all";
    let activeTier = "all";

    const tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;flex-shrink:0;";

    const tierBar = document.createElement("div");
    tierBar.style.cssText = "display:flex;gap:4px;margin-bottom:10px;flex-shrink:0;align-items:center;";
    tierBar.innerHTML = `<span style="font-size:11px;color:var(--muted);margin-right:4px;">階級：</span>`;

    function mkChip(label, active, onClick, color) {
      const c = document.createElement("span");
      c.textContent = label;
      c.style.cssText = `padding:3px 10px;border-radius:20px;font-size:12px;cursor:pointer;border:1px solid ${color||'var(--line)'};transition:all 0.15s;`;
      c.style.background = active ? (color||'var(--accent)') : 'transparent';
      c.style.color = active ? '#111' : (color||'var(--text)');
      c.addEventListener("click", onClick);
      return c;
    }

    function renderTabBar() {
      tabBar.innerHTML = "";
      TABS.forEach(t => {
        const c = mkChip(t.label, activeTab === t.key, () => { activeTab = t.key; renderTabBar(); renderTierBar(); renderItems(search.value); });
        tabBar.appendChild(c);
      });
    }

    function renderTierBar() {
      // 只有裝備類和卡片顯示 tier 篩選
      const showTier = ["all","weapon","defense","head","accessory","monster_card"].includes(activeTab);
      tierBar.style.display = showTier ? "flex" : "none";
      // 重繪 tier chips（保留第一個 label span）
      while (tierBar.children.length > 1) tierBar.removeChild(tierBar.lastChild);
      [["all","全部","var(--muted)"],["D","D 級",TIER_COLORS.D],["C","C 級",TIER_COLORS.C],["B","B 級",TIER_COLORS.B],["A","A 級",TIER_COLORS.A]].forEach(([v,l,col]) => {
        const c = mkChip(l, activeTier === v, () => { activeTier = v; renderTierBar(); renderItems(search.value); }, col);
        tierBar.appendChild(c);
      });
    }

    // ── 屬性摘要 ──
    function formatStats(equipStats) {
      if (!equipStats) return "";
      return Object.entries(equipStats).map(([k,v]) => `${k.toUpperCase()}+${v}`).join(" ");
    }

    // ── 分類判定 ──
    function getTab(it) {
      if (it.itemType === "consumable") return "consumable";
      if (it.itemType === "collectible") return "collectible";
      if (it.itemType === "job_badge") return "job_badge";
      if (it.itemType === "monster_card") return "monster_card";
      if (it.itemType !== "equipment") return "other";
      const slot = it.equipSlot || "";
      if (slot === "weapon") return "weapon";
      if (slot === "shield" || slot === "armor" || slot === "garment" || slot === "shoes") return "defense";
      if (slot.startsWith("head")) return "head";
      if (slot.startsWith("accessory")) return "accessory";
      return "defense";
    }

    // ── Render ──
    const content = document.createElement("div");
    content.style.cssText = "flex:1;overflow-y:auto;overflow-x:hidden;";

    function makeCard(it) {
      const card = document.createElement("div");
      card.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;cursor:pointer;border:1px solid transparent;transition:background 0.12s;";
      card.addEventListener("mouseenter", () => { card.style.background = "var(--surface-hover)"; card.style.borderColor = "var(--accent)"; });
      card.addEventListener("mouseleave", () => { card.style.background = ""; card.style.borderColor = "transparent"; });
      const thumb = it.imageThumbnailUrl || it.imageUrl || "";
      const tierBadge = it.tier ? `<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${TIER_COLORS[it.tier]||'#888'};color:#111;font-weight:700;margin-left:4px;">${it.tier}</span>` : "";
      const statsLine = it.itemType === "equipment" ? `<div style="font-size:10px;color:var(--muted);margin-top:1px;">${formatStats(it.equipStats)||'—'}</div>` : `<div style="font-size:10px;color:var(--muted);">${it.effect?.type !== 'none' ? it.effect?.type : ''}</div>`;
      card.innerHTML = `${thumb ? `<img src="${thumb}" style="width:34px;height:34px;object-fit:contain;border-radius:5px;flex-shrink:0;"/>` : `<div style="width:34px;height:34px;background:rgba(255,255,255,0.05);border-radius:5px;flex-shrink:0;"></div>`}<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.name}${tierBadge}</div>${statsLine}</div>`;
      card.addEventListener("click", () => {
        if (typeof modal._cb === "function") modal._cb(it, parseFloat(chanceInput.value) || 0);
        modal.style.display = "none"; modal._cb = null;
      });
      return card;
    }

    function renderItems(filter) {
      content.innerHTML = "";
      const kw = (filter || "").trim().toLowerCase();
      let list = kw ? itemLib.filter(i => (i.name||"").toLowerCase().includes(kw)) : itemLib;
      if (activeTab !== "all") list = list.filter(i => getTab(i) === activeTab);
      if (activeTier !== "all") list = list.filter(i => i.tier === activeTier);

      if (!list.length) {
        content.innerHTML = `<div style="text-align:center;color:var(--muted);padding:40px;">沒有符合條件的道具</div>`;
        return;
      }

      // 武器按 weaponType 分群，其他不分群
      if (activeTab === "weapon" || (activeTab === "all" && !kw)) {
        // 非裝備類直接列出
        const nonEq = list.filter(i => i.itemType !== "equipment");
        const weapons = list.filter(i => i.equipSlot === "weapon");
        const nonWeaponEq = list.filter(i => i.itemType === "equipment" && i.equipSlot !== "weapon");

        // 武器按 weaponType 分群
        if (weapons.length) {
          const wtGroups = {};
          weapons.forEach(i => { const wt = i.weaponType || "other"; if (!wtGroups[wt]) wtGroups[wt] = []; wtGroups[wt].push(i); });
          Object.entries(wtGroups).forEach(([wt, items]) => {
            const section = document.createElement("div");
            section.style.cssText = "margin-bottom:14px;";
            const sh = document.createElement("div");
            sh.style.cssText = "font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;border-bottom:1px solid var(--line);padding-bottom:4px;";
            sh.textContent = WEAPON_TYPE_LABELS[wt] || wt;
            section.appendChild(sh);
            const grid = document.createElement("div");
            grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;";
            items.forEach(it => grid.appendChild(makeCard(it)));
            section.appendChild(grid);
            content.appendChild(section);
          });
        }

        // 其他裝備 + 非裝備
        const rest = [...nonWeaponEq, ...nonEq];
        if (rest.length) {
          const grid = document.createElement("div");
          grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;";
          rest.forEach(it => grid.appendChild(makeCard(it)));
          content.appendChild(grid);
        }
      } else {
        // 其他 tab：直接 grid
        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;";
        list.forEach(it => grid.appendChild(makeCard(it)));
        content.appendChild(grid);
      }
    }

    search.addEventListener("input", () => renderItems(search.value));
    renderTabBar();
    renderTierBar();

    panel.append(header, search, tabBar, tierBar, content);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    modal.open = function ({ currentItemId = "", currentChance = 10, cb = null } = {}) {
      modal._cb = cb;
      chanceInput.value = currentChance;
      search.value = "";
      activeTab = "all";
      activeTier = "all";
      renderTabBar();
      renderTierBar();
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

  function buildNpcEncounterRow(entry = {}, index = 0) {
    const data = normalizeNpcEncounter(entry, index);
    const row = document.createElement("div");
    row.className = "npc-encounter-row";
    row.style.cssText = "display:grid;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--surface);";

    const templateOptions = [
      `<option value="">請選擇 NPC 模板</option>`,
      ...npcTemplates.map((tpl) => {
        const npc = tpl.npc || {};
        const label = npc.name || tpl.name || tpl.id;
        return `<option value="${tpl.id}"${tpl.id === data.eventId ? " selected" : ""}>${esc(label)}</option>`;
      })
    ].join("");

    row.innerHTML = `
      <div style="display:grid;grid-template-columns:1.5fr 110px 130px auto;gap:8px;align-items:center;">
        <select class="sheet-input" data-field="eventId">${templateOptions}</select>
        <input class="sheet-input" data-field="chance" type="number" min="0" max="100" step="0.1" value="${data.chance}" />
        <input class="sheet-input" data-field="triggerMonsterSeq" type="number" min="1" step="1" value="${data.triggerMonsterSeq ?? ""}" placeholder="任何怪物" />
        <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" class="button" data-role="move-up">↑</button>
          <button type="button" class="button" data-role="move-down">↓</button>
          <button type="button" class="button danger" data-role="remove-npc">刪除</button>
        </div>
      </div>
      <div class="hint npc-encounter-preview"></div>
    `;

    function refreshPreview() {
      const preview = row.querySelector(".npc-encounter-preview");
      const tpl = getNpcTemplate(row.querySelector('[data-field="eventId"]')?.value || "");
      if (!preview) return;
      if (!tpl) {
        preview.textContent = "尚未選擇 NPC 模板";
        return;
      }
      const npc = tpl.npc || {};
      const name = npc.name || tpl.name || tpl.id;
      preview.textContent = `${name} / 權重 ${Number(row.querySelector('[data-field="chance"]')?.value) || 0}% / ${row.querySelector('[data-field="triggerMonsterSeq"]')?.value ? `指定怪物序號 ${row.querySelector('[data-field="triggerMonsterSeq"]')?.value}` : "任意怪物"}`;
    }

    row.querySelectorAll("input,select").forEach((el) => {
      el.addEventListener("input", refreshPreview);
      el.addEventListener("change", refreshPreview);
    });
    row.querySelector('[data-role="move-up"]').addEventListener("click", () => {
      const prev = row.previousElementSibling;
      if (prev && prev.classList.contains("npc-encounter-row")) row.parentElement.insertBefore(row, prev);
    });
    row.querySelector('[data-role="move-down"]').addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains("npc-encounter-row")) row.parentElement.insertBefore(next, row);
    });
    row.querySelector('[data-role="remove-npc"]').addEventListener("click", () => row.remove());
    refreshPreview();

    row._read = () => {
      const eventId = row.querySelector('[data-field="eventId"]')?.value || "";
      if (!eventId) return null;
      return normalizeNpcEncounter({
        eventId,
        chance: row.querySelector('[data-field="chance"]')?.value,
        triggerMonsterSeq: row.querySelector('[data-field="triggerMonsterSeq"]')?.value
      });
    };
    return row;
  }

  function renderNpcEncounterList(container, rows) {
    if (!container) return;
    container.innerHTML = "";
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "hint npc-encounter-empty";
      empty.style.margin = "0";
      empty.textContent = "尚未設定 NPC 遭遇池，按「＋ 新增 NPC」開始新增。";
      container.appendChild(empty);
      return;
    }
    list.forEach((entry, index) => container.appendChild(buildNpcEncounterRow(entry, index)));
  }

  function readNpcEncounterList(container) {
    if (!container) return [];
    return [...container.querySelectorAll(".npc-encounter-row")]
      .map((row, index) => {
        const data = row._read ? row._read() : null;
        if (!data) return null;
        return { ...data, order: index };
      })
      .filter((entry) => entry && entry.eventId);
  }

  async function saveNpcEncounters() {
    const container = document.getElementById("npc-encounters-list");
    if (!container) return;
    const npcMappings = readNpcEncounterList(container);
    const nextState = {
      ...(zoneState || {}),
      npcMappings
    };
    const r = await fetch(BASE + "/monsters/state", {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify({ zone: activeZone, npcMappings })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status !== "ok") {
      alert("儲存 NPC 遭遇設定失敗: " + (j.message || r.status));
      return;
    }
    zoneState = nextState;
    await loadState();
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
    zoneState = state || {};
    const npcMappings = Array.isArray(zoneState.npcMappings) ? zoneState.npcMappings : [];
    const killCount = state?.killCount || {};

    // 建立怪物選區（依 seq 排序，只顯示當前分區）
    const zoneMonsters = monsters.filter((m) => (m.zone || "normal") === activeZone);
    const enabledMonsters = zoneMonsters
      .filter(m => m.enabled !== false)
      .sort((a,b) => a.seq - b.seq);
    const disabledCount = Math.max(0, zoneMonsters.length - enabledMonsters.length);
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
          <p class="hint" style="margin:2px 0;">
            本區怪物：${zoneMonsters.length} 隻（啟用 ${enabledMonsters.length}、停用 ${disabledCount}）
          </p>
        </div>
        ${active?.imageThumbnailUrl ? `<img src="${active.imageThumbnailUrl}" style="width:56px;height:56px;object-fit:contain;border-radius:6px;" />` : ""}
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <label style="font-size:0.88em;color:var(--muted,#aaa);">強制指定上場怪物：</label>
        <select id="monsters-zone-sel" class="sheet-input" style="width:200px;">${options.length ? options : `<option value="">請先新增怪物</option>`}</select>
        <button id="monsters-zone-switch-btn" class="button primary" style="padding:4px 14px;${isMid ? "background:#f97316;" : ""}">切換上場</button>
        <span id="monsters-zone-msg" style="font-size:0.82em;color:${accentColor};"></span>
      </div>
      <div style="margin-top:16px;display:grid;gap:10px;padding-top:12px;border-top:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div>
            <strong style="display:block;">地圖 NPC 遭遇池</strong>
            <span class="hint">來源：NPC 編輯器模板；可用順序與權重安排出現。</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button id="monsters-btn-new-npc" class="button">＋ 新增 NPC</button>
            <button id="npc-encounters-save-btn" class="button primary">儲存 NPC 遭遇設定</button>
          </div>
        </div>
        <div id="npc-encounters-list" style="display:grid;gap:8px;"></div>
      </div>
    `;

    const switchBtn = document.getElementById("monsters-zone-switch-btn");
    if (switchBtn) switchBtn.onclick = async () => {
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
    };

    const npcList = document.getElementById("npc-encounters-list");
    if (npcList) {
      renderNpcEncounterList(npcList, npcMappings);
    }
    const saveBtn = document.getElementById("npc-encounters-save-btn");
    if (saveBtn) saveBtn.onclick = saveNpcEncounters;
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

  function renderHead() {} // card 模式不需要 table head

  function buildCalcHtml(m) {
    const d = calcDerived(m);
    const defPct = Math.min(75, Number(m.def) || 0);
    const effAtk = Math.round(d.atk * (1 - defPct / 100));
    return `ATK:${d.atk} DEF:${defPct}% 實傷≈${effAtk} 閃:${d.dodge}%`;
  }

  function buildRow(m, isNew) {
    const card = document.createElement("div");
    card.className = "monster-card";
    card.dataset.id = m.id || "";
    card.dataset.isNew = isNew ? "1" : "0";
    card.style.cssText = [
      "border:1px solid var(--line);border-radius:10px;padding:14px 16px;",
      "background:var(--surface);display:flex;flex-direction:column;gap:10px;",
    ].join("");

    const enabled = m.enabled !== false;
    const seq = m.seq || 1;
    const maxHp = Number(m.maxHp) || 0;
    const level = Number(m.level) || 1;
    const atk = (Number(m.str) || 0) * 3;
    const sg = suggestRewards(maxHp, level, atk);
    const imgSrc = m.imageThumbnailUrl || m.imageUrl || "";

    // ── Row 1：圖片 + 基本資訊 + 屬性 ──
    const row1 = document.createElement("div");
    row1.style.cssText = "display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px;";
    row1.innerHTML = `
      <div class="img-cell" style="flex-shrink:0;width:56px;height:56px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:8px;cursor:pointer;overflow:hidden;">
        ${imgSrc ? `<img src="${imgSrc}" style="width:52px;height:52px;object-fit:contain;" class="monster-img-preview"/>` : `<span style="font-size:1.6em;" class="monster-img-preview">➕</span>`}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:11px;color:var(--muted);">順</label>
          <input class="sheet-input" data-field="seq" type="number" min="1" step="1" value="${seq}" style="width:60px;text-align:center;${!enabled?'opacity:0.4;pointer-events:none;':''}" ${!enabled?'disabled':''} />
          <label style="font-size:11px;color:var(--muted);">名稱</label>
          <input class="sheet-input" data-field="name" type="text" value="${(m.name||"").replace(/"/g,"&quot;")}" style="width:160px;" />
          <label style="font-size:11px;color:var(--muted);">等級</label>
          <input class="sheet-input" data-field="level" type="number" min="0" max="20" step="1" value="${m.level??1}" style="width:64px;text-align:center;" />
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:11px;color:var(--muted);">MaxHP</label>
          <input class="sheet-input" data-field="maxHp" type="number" min="1" value="${m.maxHp||1}" style="width:100px;text-align:center;" />
          <label style="font-size:11px;color:var(--muted);">DEF%</label>
          <input class="sheet-input" data-field="def" type="number" min="0" max="75" value="${m.def||0}" style="width:72px;text-align:center;" />
        </div>
        <div class="calc-cell" style="font-size:11px;color:var(--muted);line-height:1.6;">${buildCalcHtml(m)}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;flex-shrink:0;">
        ${STAT_KEYS.map(k => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <label style="font-size:10px;color:var(--muted);text-transform:uppercase;">${k}</label>
            <input class="sheet-input stat-input" data-stat="${k}" type="number" min="0" step="1" value="${m[k]??1}" style="width:64px;text-align:center;" />
          </div>`).join("")}
      </div>
    `;

    // ── Row 2：獎勵 + 掉落 + 設定 + 操作 ──
    const row2 = document.createElement("div");
    row2.style.cssText = "display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px;border-top:1px solid var(--line);padding-top:10px;";
    row2.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:11px;color:var(--muted);">入場費</label>
          <input class="sheet-input" data-field="entryFee" type="number" min="0" value="${m.entryFee||0}" style="width:88px;text-align:center;" />
          <label style="font-size:11px;color:var(--muted);">EXP</label>
          <input class="sheet-input" data-field="expReward" type="number" min="0" value="${m.expReward||0}" placeholder="建議:${sg.exp}" style="width:96px;text-align:center;" />
          <label style="font-size:11px;color:var(--muted);">金幣</label>
          <input class="sheet-input" data-field="goldReward" type="number" min="0" value="${m.goldReward||0}" placeholder="建議:${sg.gold}" style="width:96px;text-align:center;" />
          <label style="font-size:11px;color:var(--muted);">出現率%</label>
          <input class="sheet-input" data-field="spawnRate" type="number" min="1" max="100" step="1" value="${m.spawnRate??10}" style="width:72px;text-align:center;" />
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
            <input type="checkbox" data-field="isBoss" ${m.isBoss?"checked":""} /> BOSS
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
            <input type="checkbox" data-field="enabled" ${enabled?"checked":""} /> 啟用
          </label>
          <button class="button primary btn-save" style="padding:4px 14px;font-size:0.82em;">儲存</button>
          <button class="button btn-delete" style="padding:4px 10px;font-size:0.82em;">刪除</button>
        </div>
      </div>
      <div class="drops-td" style="flex:1;min-width:200px;"></div>
    `;

    card.appendChild(row1);
    card.appendChild(row2);
    card.querySelector(".drops-td").appendChild(buildDropsEditor(m.drops || []));
    return card;
  }
  function renderBody() {
    const container = document.getElementById("monsters-tbody");
    if (!container) return;
    const fresh = container.cloneNode(false);
    container.replaceWith(fresh);
    monsters.filter(m => (m.zone || "normal") === activeZone).forEach(m => fresh.appendChild(buildRow(m, false)));
    bindTableEvents(fresh);
  }

  function updateCalc(card) {
    const stats = {};
    card.querySelectorAll(".stat-input").forEach(inp => { stats[inp.dataset.stat] = Number(inp.value)||0; });
    stats.def = Number(card.querySelector("[data-field=def]")?.value) || 0;
    const cell = card.querySelector(".calc-cell");
    if (cell) cell.textContent = buildCalcHtml(stats);
    const maxHp = Number(card.querySelector("[data-field=maxHp]")?.value) || 0;
    const level = Number(card.querySelector("[data-field=level]")?.value) || 1;
    const atk = (Number(stats.str) || 0) * 3;
    const sg = suggestRewards(maxHp, level, atk);
    const expInput  = card.querySelector("[data-field=expReward]");
    const goldInput = card.querySelector("[data-field=goldReward]");
    if (expInput)  expInput.placeholder  = `建議:${sg.exp}`;
    if (goldInput) goldInput.placeholder = `建議:${sg.gold}`;
  }

  function bindTableEvents(container) {
    container.addEventListener("input", function (e) {
      const card = e.target.closest(".monster-card");
      if (!card) return;
      if (e.target.classList.contains("stat-input") || ["maxHp","def","level"].includes(e.target.dataset.field)) {
        updateCalc(card);
      }
    });
    container.addEventListener("click", async function (e) {
      const card = e.target.closest(".monster-card");
      if (!card) return;
      if (e.target.classList.contains("btn-save")) { await saveRow(card); }
      else if (e.target.classList.contains("btn-delete")) {
        const id = card.dataset.id;
        const name = card.querySelector("[data-field=name]")?.value || id;
        if (!confirm(`刪除怪物「${name}」？`)) return;
        await deleteMonster(id);
      } else if (e.target.closest(".monster-img-preview")) {
        const id = card.dataset.id;
        if (!id || card.dataset.isNew === "1") { alert("請先儲存怪物再上傳圖片"); return; }
        pendingImgRowId = id;
        document.getElementById("monsters-img-input")?.click();
      }
    });
  }

  function getPayload(card) {
    const stats = {};
    card.querySelectorAll(".stat-input").forEach(inp => { stats[inp.dataset.stat] = inp.value === "" ? 0 : (Number(inp.value) ?? 0); });
    const dropsTd = card.querySelector(".drops-td");
    return {
      seq:        Number(card.querySelector("[data-field=seq]")?.value)       || 1,
      name:              card.querySelector("[data-field=name]")?.value       || "",
      zone:        activeZone,
      level:      Number(card.querySelector("[data-field=level]")?.value)     ?? 1,
      ...stats,
      maxHp:      Number(card.querySelector("[data-field=maxHp]")?.value)     || 1,
      def:        Number(card.querySelector("[data-field=def]")?.value)       || 0,
      entryFee:   Number(card.querySelector("[data-field=entryFee]")?.value)  || 0,
      expReward:  Number(card.querySelector("[data-field=expReward]")?.value) || 0,
      goldReward: Number(card.querySelector("[data-field=goldReward]")?.value)|| 0,
      drops:      dropsTd ? readDropsFromEditor(dropsTd) : [],
      spawnRate:  Number(card.querySelector("[data-field=spawnRate]")?.value) || 10,
      isBoss:            card.querySelector("[data-field=isBoss]")?.checked   || false,
      enabled:           card.querySelector("[data-field=enabled]")?.checked  || false
    };
  }

  async function saveRow(card) {
    if (card.dataset.saving === "1") return;
    card.dataset.saving = "1";
    try {
      const payload = getPayload(card);
      const id = card.dataset.id;
      const isNew = card.dataset.isNew === "1";
      const url = isNew ? BASE + "/monsters" : BASE + "/monsters/" + id;
      const method = isNew ? "POST" : "PUT";
      const r = await fetch(url, { method, headers: apiHeaders(), body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok || j.status !== "ok") { alert("儲存失敗: " + (j.message || r.status)); return; }
      await loadMonsters();
    } catch (err) {
      alert("儲存發生錯誤: " + err.message);
    } finally {
      card.dataset.saving = "0";
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
    const container = document.getElementById("monsters-tbody");
    if (!container) return;
    const nextSeq = monsters.length ? Math.max(...monsters.map(m => m.seq||1)) + 1 : 1;
    const blank = { id: "", seq: nextSeq, name: "", zone: activeZone, level: 1, str:5, agi:5, vit:5, int:5, dex:5, luk:5, maxHp:1000, def:50, entryFee:0, expReward:0, goldReward:0, spawnRate:10, isBoss:false, drops:[], enabled:true };
    const card = buildRow(blank, true);
    container.appendChild(card);
    card.querySelector("[data-field=name]")?.focus();
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
        const card = document.querySelector(`.monster-card[data-id="${rowId}"]`);
        const cell = card?.querySelector(".img-cell");
        if (cell) cell.innerHTML = `<img src="${thumb}" style="width:52px;height:52px;object-fit:contain;" class="monster-img-preview"/>`;
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
    await loadNpcTemplates().catch(() => { npcTemplates = []; });
    await loadMonsters();
    initImageUpload();
    initZoneTabs();
    document.getElementById("monsters-btn-new")?.addEventListener("click", addNewRow);
    document.getElementById("monsters-btn-new-npc")?.addEventListener("click", async () => {
      const container = document.getElementById("npc-encounters-list");
      if (!container) return;
      const row = buildNpcEncounterRow({}, container.querySelectorAll(".npc-encounter-row").length);
      container.appendChild(row);
      container.querySelector(".npc-encounter-empty")?.remove();
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      const selector = row.querySelector('[data-field="eventId"]');
      if (selector) selector.focus();
    });
    document.getElementById("npc-encounters-save-btn")?.addEventListener("click", saveNpcEncounters);
  });
})();

