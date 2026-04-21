(function () {
  const BASE = "/admin/idle-zones";
  let zones = [];

  const listEl = document.getElementById("idle-zones-list");
  const refreshBtn = document.getElementById("idle-zones-refresh-btn");
  const addBtn = document.getElementById("idle-zones-add-btn");
  const seedBtn = document.getElementById("idle-zones-seed-btn");

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (window.getAdminToken ? window.getAdminToken() : "")
    };
  }

  async function parseJsonSafe(res, apiName) {
    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();
    if (!contentType.includes("application/json")) {
      const preview = text.slice(0, 160).replace(/\s+/g, " ").trim();
      throw new Error(`${apiName} 回傳非 JSON（HTTP ${res.status}）：${preview || "empty response"}`);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      const preview = text.slice(0, 160).replace(/\s+/g, " ").trim();
      throw new Error(`${apiName} JSON 解析失敗：${error.message}；response=${preview}`);
    }
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function defaultRewardTiersText() {
    return JSON.stringify(
      [{ minLevel: 1, maxLevel: 999, goldPerMinute: 10, expPerMinute: 8, drops: [] }],
      null,
      2
    );
  }

  function toNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function buildCard(zone, isNew) {
    const card = document.createElement("div");
    card.className = "access-card";
    card.dataset.zoneId = zone.id || "";
    card.dataset.isNew = isNew ? "1" : "0";
    card.style.display = "grid";
    card.style.gap = "10px";

    const rewardTiersText = zone.rewardTiers
      ? JSON.stringify(zone.rewardTiers, null, 2)
      : defaultRewardTiersText();

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div>
          <h3 style="margin:0 0 6px 0;">${esc(zone.name || "新掛機區")}</h3>
          <p class="hint" style="margin:0;">ID: ${esc(zone.id || "(新增後產生)")}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button primary idle-save-btn" type="button">💾 儲存</button>
          <button class="button idle-delete-btn" type="button" style="background:var(--error,#b91c1c);">🗑️ 刪除</button>
        </div>
      </div>

      <div class="access-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">
        <label><span>名稱</span><input data-field="name" class="sheet-input" type="text" value="${esc(zone.name || "")}" /></label>
        <label><span>排序</span><input data-field="sortOrder" class="sheet-input" type="number" min="0" value="${toNumber(zone.sortOrder, 0)}" /></label>
        <label><span>最小等級</span><input data-field="minLevel" class="sheet-input" type="number" min="1" value="${toNumber(zone.minLevel, 1)}" /></label>
        <label><span>最大等級</span><input data-field="maxLevel" class="sheet-input" type="number" min="1" value="${toNumber(zone.maxLevel, 999)}" /></label>
        <label><span>最短可領分鐘</span><input data-field="minClaimMinutes" class="sheet-input" type="number" min="0" value="${toNumber(zone.minClaimMinutes, 5)}" /></label>
        <label><span>掛機上限分鐘</span><input data-field="maxDurationMinutes" class="sheet-input" type="number" min="1" value="${toNumber(zone.maxDurationMinutes, 480)}" /></label>
        <label><span>冷卻分鐘</span><input data-field="cooldownMinutes" class="sheet-input" type="number" min="0" value="${toNumber(zone.cooldownMinutes, 10)}" /></label>
        <label>
          <span>啟用狀態</span>
          <select data-field="enabled" class="sheet-input">
            <option value="true" ${zone.enabled !== false ? "selected" : ""}>啟用</option>
            <option value="false" ${zone.enabled === false ? "selected" : ""}>停用</option>
          </select>
        </label>
      </div>

      <label>
        <span>描述</span>
        <input data-field="description" class="sheet-input" type="text" value="${esc(zone.description || "")}" />
      </label>

      <label>
        <span>rewardTiers（JSON）</span>
        <textarea data-field="rewardTiers" rows="8" class="sheet-input" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${esc(rewardTiersText)}</textarea>
      </label>
      <p class="hint idle-card-hint" style="margin:0;color:var(--muted);">可先用單一區間，後續再依等級拆段。</p>
    `;
    return card;
  }

  function readPayload(card) {
    const rewardTiersRaw = card.querySelector("[data-field=rewardTiers]")?.value || "[]";
    let rewardTiers;
    try {
      rewardTiers = JSON.parse(rewardTiersRaw);
      if (!Array.isArray(rewardTiers)) throw new Error("rewardTiers 必須是陣列");
    } catch (error) {
      throw new Error(`rewardTiers JSON 格式錯誤：${error.message}`);
    }

    return {
      name: card.querySelector("[data-field=name]")?.value?.trim() || "",
      description: card.querySelector("[data-field=description]")?.value?.trim() || "",
      sortOrder: toNumber(card.querySelector("[data-field=sortOrder]")?.value, 0),
      minLevel: toNumber(card.querySelector("[data-field=minLevel]")?.value, 1),
      maxLevel: toNumber(card.querySelector("[data-field=maxLevel]")?.value, 999),
      minClaimMinutes: toNumber(card.querySelector("[data-field=minClaimMinutes]")?.value, 5),
      maxDurationMinutes: toNumber(card.querySelector("[data-field=maxDurationMinutes]")?.value, 480),
      cooldownMinutes: toNumber(card.querySelector("[data-field=cooldownMinutes]")?.value, 10),
      enabled: card.querySelector("[data-field=enabled]")?.value !== "false",
      rewardTiers
    };
  }

  async function loadZones() {
    if (!listEl) return;
    listEl.innerHTML = `<p class="hint">載入中…</p>`;
    try {
      const res = await fetch(`${BASE}?includeDisabled=true`, { headers: apiHeaders() });
      const json = await parseJsonSafe(res, "GET /admin/idle-zones");
      if (!res.ok || json.status !== "ok") throw new Error(json.message || `HTTP ${res.status}`);
      zones = Array.isArray(json.data) ? json.data : [];
      renderList();
    } catch (error) {
      listEl.innerHTML = `<p class="hint" style="color:var(--error,#f87171);">❌ ${esc(error.message)}</p>`;
    }
  }

  function renderList() {
    if (!listEl) return;
    if (!zones.length) {
      listEl.innerHTML = `<p class="hint">目前沒有掛機區，點「新增掛機區」或「建立預設區域」。</p>`;
      return;
    }
    listEl.innerHTML = "";
    zones.forEach((zone) => listEl.appendChild(buildCard(zone, false)));
  }

  function addNewZoneCard() {
    if (!listEl) return;
    const zone = {
      id: "",
      name: "新掛機區",
      description: "",
      enabled: true,
      sortOrder: zones.length ? Math.max(...zones.map((z) => Number(z.sortOrder || 0))) + 10 : 10,
      minLevel: 1,
      maxLevel: 999,
      minClaimMinutes: 5,
      maxDurationMinutes: 480,
      cooldownMinutes: 10,
      rewardTiers: [{ minLevel: 1, maxLevel: 999, goldPerMinute: 10, expPerMinute: 8, drops: [] }]
    };
    const card = buildCard(zone, true);
    listEl.prepend(card);
    card.querySelector("[data-field=name]")?.focus();
  }

  async function saveCard(card) {
    const hint = card.querySelector(".idle-card-hint");
    const saveBtn = card.querySelector(".idle-save-btn");
    if (!saveBtn) return;
    if (saveBtn.dataset.loading === "1") return;
    saveBtn.dataset.loading = "1";
    saveBtn.textContent = "儲存中…";
    try {
      const payload = readPayload(card);
      if (!payload.name) throw new Error("名稱不可為空");

      const isNew = card.dataset.isNew === "1";
      const zoneId = card.dataset.zoneId;
      const url = isNew ? BASE : `${BASE}/${encodeURIComponent(zoneId)}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: apiHeaders(),
        body: JSON.stringify(payload)
      });
      const json = await parseJsonSafe(res, `${method} ${url}`);
      if (!res.ok || json.status !== "ok") throw new Error(json.message || `HTTP ${res.status}`);
      if (hint) hint.textContent = "✅ 已儲存";
      await loadZones();
    } catch (error) {
      if (hint) hint.textContent = `❌ ${error.message}`;
    } finally {
      saveBtn.dataset.loading = "0";
      saveBtn.textContent = "💾 儲存";
    }
  }

  async function deleteCard(card) {
    const zoneId = card.dataset.zoneId;
    if (!zoneId) {
      card.remove();
      return;
    }
    if (!confirm("確定要刪除這個掛機區嗎？")) return;
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(zoneId)}`, {
        method: "DELETE",
        headers: apiHeaders()
      });
      const json = await parseJsonSafe(res, `DELETE ${BASE}/${zoneId}`);
      if (!res.ok || json.status !== "ok") throw new Error(json.message || `HTTP ${res.status}`);
      await loadZones();
    } catch (error) {
      alert(`刪除失敗：${error.message}`);
    }
  }

  async function seedDefaultZones() {
    if (!confirm("建立預設放置掛機區？（如果已有資料不會覆蓋）")) return;
    if (seedBtn) {
      seedBtn.disabled = true;
      seedBtn.textContent = "建立中…";
    }
    try {
      const res = await fetch(`${BASE}/seed`, {
        method: "POST",
        headers: apiHeaders()
      });
      const json = await parseJsonSafe(res, "POST /admin/idle-zones/seed");
      if (!res.ok || json.status !== "ok") throw new Error(json.message || `HTTP ${res.status}`);
      await loadZones();
    } catch (error) {
      alert(`建立預設失敗：${error.message}`);
    } finally {
      if (seedBtn) {
        seedBtn.disabled = false;
        seedBtn.textContent = "🌱 建立預設區域";
      }
    }
  }

  function bindListEvents() {
    if (!listEl) return;
    listEl.addEventListener("click", (event) => {
      const card = event.target.closest(".access-card");
      if (!card) return;
      if (event.target.closest(".idle-save-btn")) {
        saveCard(card);
      } else if (event.target.closest(".idle-delete-btn")) {
        deleteCard(card);
      }
    });
  }

  function bindTopActions() {
    refreshBtn?.addEventListener("click", loadZones);
    addBtn?.addEventListener("click", addNewZoneCard);
    seedBtn?.addEventListener("click", seedDefaultZones);
  }

  bindTopActions();
  bindListEvents();

  document.addEventListener("adminConnected", () => {
    loadZones();
  });
})();
