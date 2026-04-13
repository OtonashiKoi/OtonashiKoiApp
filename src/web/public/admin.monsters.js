(function () {
  const BASE = "/admin";
  const STATE_AREA = document.getElementById("monsters-state-area");
  const LIST_EL = document.getElementById("monsters-tbody");
  const IMG_INPUT = document.getElementById("monsters-img-input");
  const NEW_BTN = document.getElementById("monsters-btn-new");
  if (!LIST_EL) return;

  const STAT_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
  const SLOT_GROUPS = {
    weapon: ["weapon"],
    defense: ["shield", "armor", "garment", "shoes"],
    head: ["head_top", "head_mid", "head_low"],
    accessory: ["accessory_l", "accessory_r"]
  };

  let monsters = [];
  let itemLib = [];
  let activeZone = "normal";
  let pendingImgMonsterId = null;

  function token() {
    return window.getAdminToken ? window.getAdminToken() : "";
  }

  function apiHeaders(json = true) {
    const headers = { Authorization: `Bearer ${token()}` };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...apiHeaders(options.body instanceof FormData ? false : true),
        ...(options.headers || {})
      }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status !== "ok") throw new Error(payload?.error?.message || payload?.message || `HTTP ${res.status}`);
    return payload.data;
  }

  function esc(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function calcPreview(monster) {
    const str = Number(monster.str) || 0;
    const agi = Number(monster.agi) || 0;
    const dex = Number(monster.dex) || 0;
    return {
      atk: str * 3,
      dodge: Math.min(50, Math.round(agi * 0.5 * 10) / 10),
      hit: Math.min(100, 80 + dex)
    };
  }

  function suggestRewards(monster) {
    const maxHp = Number(monster.maxHp) || 1;
    const level = Number(monster.level) || 1;
    const atk = calcPreview(monster).atk;
    const exp = Math.max(1, Math.round(maxHp / 15 * 1.2 + level * 50 + atk * 8));
    const gold = Math.max(1, Math.round(exp * 0.82));
    return { exp, gold };
  }

  function buildDropRow(drop = {}) {
    const row = document.createElement("div");
    row.className = "monster-drop-row";
    row.style.cssText = "display:flex;gap:8px;align-items:center;";
    const options = [`<option value="">?豢???</option>`]
      .concat(itemLib.map((item) => `<option value="${esc(item.id)}"${item.id === drop.itemId ? " selected" : ""}>${esc(item.name)}</option>`))
      .join("");
    row.innerHTML = `
      <select class="sheet-input" data-field="dropItemId" style="flex:1;">${options}</select>
      <input class="sheet-input" data-field="dropChance" type="number" min="0" max="100" step="0.1" value="${Number(drop.chance) || 0}" style="width:88px;" />
      <span class="hint">%</span>
      <button type="button" class="button danger" data-role="delete-drop">?芷</button>
    `;
    return row;
  }

  function buildDropRowCard(drop = {}) {
    const row = document.createElement("div");
    row.className = "monster-drop-row";
    row.style.cssText = "display:flex;gap:8px;align-items:center;";
    const selectedItem = itemLib.find((item) => item.id === drop.itemId) || null;
    const dropPreviewHtml = (item) => {
      if (!item) return esc("尚未選擇道具");
      const thumb = item.imageThumbnailUrl || item.imageUrl || "";
      const name = item.name || item.id || "未命名道具";
      if (!thumb) return esc(name);
      return `
        <span style="display:inline-flex;align-items:center;gap:8px;max-width:100%;">
          <img src="${esc(thumb)}" alt="${esc(name)}" style="width:26px;height:26px;object-fit:cover;border-radius:6px;flex:0 0 auto;" />
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>
        </span>
      `;
    };
    row.innerHTML = `
      <input type="hidden" data-field="dropItemId" value="${esc(drop.itemId || "")}" />
      <button type="button" class="button" data-role="pick-drop-item" style="min-width:220px;">?豢??嚗??∴?</button>
      <span class="hint" data-role="drop-item-preview" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dropPreviewHtml(selectedItem)}</span>
      <input class="sheet-input" data-field="dropChance" type="number" min="0" max="100" step="0.1" value="${Number(drop.chance) || 0}" style="width:88px;" />
      <span class="hint">%</span>
      <button type="button" class="button danger" data-role="delete-drop">?芷</button>
    `;

    row.querySelector('[data-role="pick-drop-item"]')?.addEventListener("click", async () => {
      try {
        await window.adminCore.openItemPicker({
          title: "?豢??芰??",
          selectedId: row.querySelector('[data-field="dropItemId"]')?.value || "",
          onPick: (item) => {
            const idEl = row.querySelector('[data-field="dropItemId"]');
            const preview = row.querySelector('[data-role="drop-item-preview"]');
            if (idEl) idEl.value = item?.id || "";
            if (preview) preview.innerHTML = dropPreviewHtml(item);
          }
        });
      } catch (error) {
        alert(error.message || String(error));
      }
    });
    return row;
  }

  function buildDropsEditor(drops = []) {
    const wrap = document.createElement("div");
    wrap.className = "monster-drops-editor";
    wrap.style.cssText = "display:grid;gap:8px;";
    const list = document.createElement("div");
    list.className = "monster-drop-list";
    list.style.cssText = "display:grid;gap:6px;";
    (Array.isArray(drops) ? drops : []).forEach((drop) => list.appendChild(buildDropRowCard(drop)));
    if (!list.children.length) {
      const hint = document.createElement("p");
      hint.className = "hint empty-drop";
      hint.textContent = "撠閮剖??";
      list.appendChild(hint);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "button";
    addBtn.textContent = "嚗??啣??";
    addBtn.onclick = () => {
      list.querySelector(".empty-drop")?.remove();
      list.appendChild(buildDropRowCard());
    };
    list.addEventListener("click", (event) => {
      if (!event.target.matches('[data-role="delete-drop"]')) return;
      event.target.closest(".monster-drop-row")?.remove();
      if (!list.querySelector(".monster-drop-row")) {
        const hint = document.createElement("p");
        hint.className = "hint empty-drop";
        hint.textContent = "撠閮剖??";
        list.appendChild(hint);
      }
    });
    wrap.append(list, addBtn);
    return wrap;
  }

  function readDrops(card) {
    return [...card.querySelectorAll(".monster-drop-row")]
      .map((row) => ({
        itemId: row.querySelector('[data-field="dropItemId"]')?.value || "",
        chance: Number(row.querySelector('[data-field="dropChance"]')?.value) || 0
      }))
      .filter((drop) => drop.itemId);
  }

  function buildCard(monster = {}, isNew = false) {
    const preview = calcPreview(monster);
    const rewards = suggestRewards(monster);
    const effectDraft = {
      passiveEffects: Array.isArray(monster.passiveEffects) ? monster.passiveEffects : [],
      procEffects: Array.isArray(monster.procEffects) ? monster.procEffects : [],
      battleStartEffects: Array.isArray(monster.battleStartEffects) ? monster.battleStartEffects : [],
      skills: Array.isArray(monster.skills) ? monster.skills : []
    };
    const card = document.createElement("article");
    card.className = "access-card monster-card";
    card.dataset.id = monster.id || "";
    if (isNew) card.dataset.isNew = "1";
    card.style.cssText = "display:grid;gap:12px;";
    card.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
        <div class="monster-img-cell" style="width:68px;height:68px;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;">
          ${monster.imageThumbnailUrl || monster.imageUrl ? `<img src="${esc(monster.imageThumbnailUrl || monster.imageUrl)}" class="monster-img-preview" style="width:100%;height:100%;object-fit:contain;" />` : `<span class="hint">??</span>`}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;flex:1;min-width:320px;">
          <label><span class="hint">摨?</span><input class="sheet-input" data-field="seq" type="number" min="1" value="${Number(monster.seq) || 1}" /></label>
          <label><span class="hint">?迂</span><input class="sheet-input" data-field="name" value="${esc(monster.name || "")}" /></label>
          <label><span class="hint">蝑?</span><input class="sheet-input" data-field="level" type="number" min="1" value="${Number(monster.level) || 1}" /></label>
          <label><span class="hint">?憭?HP</span><input class="sheet-input" data-field="maxHp" type="number" min="1" value="${Number(monster.maxHp) || 1000}" /></label>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;">
        ${STAT_KEYS.map((key) => `<label><span class="hint">${key.toUpperCase()}</span><input class="sheet-input stat-input" data-stat="${key}" type="number" min="0" value="${Number(monster[key]) || 5}" /></label>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;">
        <label><span class="hint">DEF%</span><input class="sheet-input" data-field="def" type="number" min="0" max="75" value="${Number(monster.def) || 0}" /></label>
        <label><span class="hint">?亙鞎?/span><input class="sheet-input" data-field="entryFee" type="number" min="0" value="${Number(monster.entryFee) || 0}" /></label>
        <label><span class="hint">EXP</span><input class="sheet-input" data-field="expReward" type="number" min="0" value="${Number(monster.expReward) || 0}" placeholder="撱箄降 ${rewards.exp}" /></label>
        <label><span class="hint">?馳</span><input class="sheet-input" data-field="goldReward" type="number" min="0" value="${Number(monster.goldReward) || 0}" placeholder="撱箄降 ${rewards.gold}" /></label>
        <label><span class="hint">?箇??/span><input class="sheet-input" data-field="spawnRate" type="number" min="1" max="100" value="${Number(monster.spawnRate) || 10}" /></label>
        <label><span class="hint">?汗</span><div class="hint calc-preview">ATK ${preview.atk} / HIT ${preview.hit} / DODGE ${preview.dodge}</div></label>
      </div>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" data-field="isBoss" ${monster.isBoss ? "checked" : ""} /> BOSS</label>
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" data-field="enabled" ${monster.enabled !== false ? "checked" : ""} /> ?</label>
        <input type="hidden" data-field="effectDraft" value="${esc(window.adminEffects ? window.adminEffects.encodeState(effectDraft) : "")}" />
        <button type="button" class="button btn-effects">??/???/button>
        <span class="hint monster-effects-summary">${esc(window.adminEffects ? window.adminEffects.summarizeMonsterDraft(effectDraft) : "未設定")}</span>
        <button type="button" class="button primary btn-save">?脣?</button>
        <button type="button" class="button danger btn-delete">?芷</button>
      </div>
      <section style="display:grid;gap:8px;">
        <strong>?閮剖?</strong>
        <div class="monster-drops-host"></div>
      </section>
    `;
    card.querySelector(".monster-drops-host").appendChild(buildDropsEditor(monster.drops || []));
    return card;
  }

  function renderList() {
    LIST_EL.innerHTML = "";
    monsters
      .filter((monster) => (monster.zone || "normal") === activeZone)
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
      .forEach((monster) => LIST_EL.appendChild(buildCard(monster, false)));
  }

  async function loadItemLib() {
    itemLib = await api("/admin/items");
  }

  async function loadMonsters() {
    monsters = await api("/admin/monsters");
    renderList();
    await loadState();
  }

  async function loadState() {
    if (!STATE_AREA) return;
    try {
      const data = await api(`${BASE}/monsters/state?zone=${activeZone}`, { headers: apiHeaders(false) });
      const state = data.state || {};
      const active = data.active || null;
      STATE_AREA.innerHTML = `
        <div class="player-hero-card">
          <div>
            <p class="section-kicker">${activeZone === "mid" ? "MID ZONE" : "NORMAL ZONE"}</p>
            <h3 style="margin:0;">${esc(active?.name || "?桀?瘝??芰")}</h3>
            <p class="hint" style="margin:4px 0 0;">HP ${Number(state.currentHp ?? active?.calc?.maxHp ?? 0)} / ${Number(active?.calc?.maxHp ?? 0)}嚗???${Array.isArray(state.participants) ? state.participants.length : 0} 鈭?/p>
          </div>
        </div>
      `;
    } catch (error) {
      STATE_AREA.innerHTML = `<p class="hint" style="color:var(--danger);">頛??仃??${esc(error.message)}</p>`;
    }
  }

  function updatePreview(card) {
    const monster = {};
    STAT_KEYS.forEach((key) => {
      monster[key] = Number(card.querySelector(`[data-stat="${key}"]`)?.value) || 0;
    });
    const preview = calcPreview(monster);
    const previewEl = card.querySelector(".calc-preview");
    if (previewEl) previewEl.textContent = `ATK ${preview.atk} / HIT ${preview.hit} / DODGE ${preview.dodge}`;
  }

  function readCardPayload(card) {
    const effectDraft = window.adminEffects
      ? window.adminEffects.decodeState(card.querySelector('[data-field="effectDraft"]')?.value, { passiveEffects: [], procEffects: [], battleStartEffects: [], skills: [] })
      : { passiveEffects: [], procEffects: [], battleStartEffects: [], skills: [] };

    const payload = {
      seq: Number(card.querySelector('[data-field="seq"]')?.value) || 1,
      name: card.querySelector('[data-field="name"]')?.value || "",
      zone: activeZone,
      level: Number(card.querySelector('[data-field="level"]')?.value) || 1,
      maxHp: Number(card.querySelector('[data-field="maxHp"]')?.value) || 1000,
      def: Number(card.querySelector('[data-field="def"]')?.value) || 0,
      entryFee: Number(card.querySelector('[data-field="entryFee"]')?.value) || 0,
      expReward: Number(card.querySelector('[data-field="expReward"]')?.value) || 0,
      goldReward: Number(card.querySelector('[data-field="goldReward"]')?.value) || 0,
      spawnRate: Number(card.querySelector('[data-field="spawnRate"]')?.value) || 10,
      isBoss: Boolean(card.querySelector('[data-field="isBoss"]')?.checked),
      enabled: Boolean(card.querySelector('[data-field="enabled"]')?.checked),
      drops: readDrops(card),
      passiveEffects: effectDraft.passiveEffects || [],
      procEffects: effectDraft.procEffects || [],
      battleStartEffects: effectDraft.battleStartEffects || [],
      skills: effectDraft.skills || []
    };
    STAT_KEYS.forEach((key) => {
      payload[key] = Number(card.querySelector(`[data-stat="${key}"]`)?.value) || 0;
    });
    return payload;
  }

  async function saveCard(card) {
    const id = card.dataset.id;
    const isNew = card.dataset.isNew === "1";
    const payload = readCardPayload(card);
    if (!payload.name.trim()) {
      alert("隢撓?交芰?迂");
      return;
    }
    await api(isNew ? `${BASE}/monsters` : `${BASE}/monsters/${encodeURIComponent(id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(payload)
    });
    await loadMonsters();
  }

  async function deleteCard(card) {
    const id = card.dataset.id;
    if (!id) {
      card.remove();
      return;
    }
    const name = card.querySelector('[data-field="name"]')?.value || id;
    if (!confirm(`蝣箏?閬?斗芰??{name}??`)) return;
    await api(`${BASE}/monsters/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMonsters();
  }

  function addNewCard() {
    const nextSeq = monsters.length ? Math.max(...monsters.map((monster) => monster.seq || 1)) + 1 : 1;
    LIST_EL.prepend(buildCard({
      seq: nextSeq,
      zone: activeZone,
      level: 1,
      str: 5, agi: 5, vit: 5, int: 5, dex: 5, luk: 5,
      maxHp: 1000,
      def: 0,
      entryFee: 0,
      expReward: 0,
      goldReward: 0,
      spawnRate: 10,
      enabled: true,
      drops: []
    }, true));
  }

  async function uploadMonsterImage(file) {
    if (!file || !pendingImgMonsterId) return;
    const form = new FormData();
    form.append("image", file);
    const id = pendingImgMonsterId;
    pendingImgMonsterId = null;
    await api(`${BASE}/monsters/${encodeURIComponent(id)}/image`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${token()}` }
    });
    await loadMonsters();
  }

  function bindEvents() {
    document.querySelectorAll(".monsters-zone-tab").forEach((button) => {
      button.addEventListener("click", () => {
        activeZone = button.dataset.zone === "mid" ? "mid" : "normal";
        document.querySelectorAll(".monsters-zone-tab").forEach((el) => el.classList.toggle("active", el === button));
        renderList();
        loadState();
      });
    });

    NEW_BTN?.addEventListener("click", addNewCard);

    LIST_EL.addEventListener("input", (event) => {
      const card = event.target.closest(".monster-card");
      if (!card) return;
      if (event.target.matches(".stat-input, [data-field='maxHp'], [data-field='level'], [data-field='def']")) {
        updatePreview(card);
      }
    });

    LIST_EL.addEventListener("click", async (event) => {
      const card = event.target.closest(".monster-card");
      if (!card) return;
      if (event.target.closest(".monster-img-cell")) {
        if (!card.dataset.id || card.dataset.isNew === "1") {
          alert("請先儲存怪物，再上傳圖片");
          return;
        }
        pendingImgMonsterId = card.dataset.id;
        IMG_INPUT.value = "";
        IMG_INPUT.click();
        return;
      }
      if (event.target.closest(".btn-save")) {
        await saveCard(card);
        return;
      }
      if (event.target.closest(".btn-delete")) {
        await deleteCard(card);
        return;
      }
      if (event.target.closest(".btn-effects")) {
        if (!window.adminEffects) return;
        await window.adminEffects.ensureLookups();
        const hidden = card.querySelector('[data-field="effectDraft"]');
        const draft = window.adminEffects.decodeState(hidden?.value, { passiveEffects: [], procEffects: [], battleStartEffects: [], skills: [] });
        window.adminEffects.openMonsterEditor(draft, (nextDraft) => {
          if (hidden) hidden.value = window.adminEffects.encodeState(nextDraft);
          const summary = card.querySelector(".monster-effects-summary");
          if (summary) summary.textContent = window.adminEffects.summarizeMonsterDraft(nextDraft);
        });
      }
    });

    IMG_INPUT?.addEventListener("change", async () => {
      const file = IMG_INPUT.files?.[0];
      try {
        await uploadMonsterImage(file);
      } catch (error) {
        alert(`??銝憭望?嚗?{error.message}`);
      } finally {
        IMG_INPUT.value = "";
      }
    });
  }

  document.addEventListener("adminConnected", async () => {
    try {
      await loadItemLib();
      bindEvents();
      await loadMonsters();
    } catch (error) {
      LIST_EL.innerHTML = `<p class="hint" style="color:var(--danger);">頛?芰鞈?憭望?嚗?{esc(error.message)}</p>`;
    }
  }, { once: true });
})();

