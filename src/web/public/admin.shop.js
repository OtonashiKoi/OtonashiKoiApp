/* admin.shop.js — 金幣商店商品管理 */
(function () {
  let shopItems = [];
  let libraryItems = [];
  let editingId = null;

  const currencyLabels = { gold: "💰 金幣", diamond: "💎 鑽石" };
  const effectLabels = {
    none: "無效果",
    grant_gold: "💰 給予金幣",
    grant_diamond: "💎 給予鑽石",
    grant_exp: "✨ 給予經驗值",
    grant_status_points: "📊 給予屬性點",
    checkin_multiplier: "🎯 打卡加倍符"
  };

  // ── DOM refs ──────────────────────────────────────────────
  const tableBody    = document.getElementById("shop-item-tbody");
  const form         = document.getElementById("shop-item-form");
  const formTitle    = document.getElementById("shop-form-title");
  const selectItemId = document.getElementById("shop-input-itemid");
  const previewCard  = document.getElementById("shop-item-preview");
  const previewImg   = document.getElementById("shop-preview-img");
  const previewName  = document.getElementById("shop-preview-name");
  const previewDesc  = document.getElementById("shop-preview-desc");
  const previewEff   = document.getElementById("shop-preview-effect");
  const inputPrice   = document.getElementById("shop-input-price");
  const inputCurrency = document.getElementById("shop-input-currency");
  const inputStock   = document.getElementById("shop-input-stock");
  const inputMaxPerMonth = document.getElementById("shop-input-maxpermonth");
  const tierCheckboxArea  = document.getElementById("shop-tier-checkboxes");
  const inputEnabled = document.getElementById("shop-input-enabled");
  const inputIsSale  = document.getElementById("shop-input-issale");
  const btnSubmit    = document.getElementById("shop-btn-submit");
  const btnCancel    = document.getElementById("shop-btn-cancel");
  const btnNew       = document.getElementById("shop-btn-new");
  const formArea     = document.getElementById("shop-form-area");

  // ── Tier checkboxes ───────────────────────────────────────
  const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];

  function renderTierCheckboxes(selectedTiers) {
    if (!tierCheckboxArea) return;
    const tiers = window.playerTiers || {};
    tierCheckboxArea.innerHTML = TIER_RANKS.map((rank) => {
      const tier = tiers[rank] || {};
      const label = tier.label || `${rank}級`;
      const checked = (selectedTiers || []).includes(rank);
      const hasRoles = Array.isArray(tier.roleIds) && tier.roleIds.length > 0;
      const hint = hasRoles ? `(${tier.roleIds.length} 組)` : `<span style="color:var(--danger);font-size:0.8em">尚未設定 Role ID</span>`;
      return `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" class="tier-cb" value="${rank}" ${checked ? "checked" : ""} />
        <span>${escHtml(label)}</span>
        <span style="color:var(--muted);font-size:0.8em">${hint}</span>
      </label>`;
    }).join("");
  }

  function getSelectedTiers() {
    if (!tierCheckboxArea) return [];
    return [...tierCheckboxArea.querySelectorAll(".tier-cb:checked")].map((cb) => cb.value);
  }

  // ── API helpers ───────────────────────────────────────────
  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}`
    };
  }

  async function loadItems() {
    const res = await fetch("/admin/shop/items", { headers: apiHeaders() });
    const json = await res.json();
    if (json.status === "ok") {
      shopItems = json.data || [];
      renderTable();
    } else {
      window.logActivity && window.logActivity("❌ 無法載入商品：" + (json.message || ""));
    }
  }

  async function loadLibraryItems() {
    const res = await fetch("/admin/items", { headers: apiHeaders() });
    const json = await res.json();
    if (json.status === "ok") {
      libraryItems = json.data || [];
      populateItemSelect();
    }
  }

  function populateItemSelect() {
    if (!selectItemId) return;
    const current = selectItemId.value;
    selectItemId.innerHTML = `<option value="">— 請選擇道具 —</option>` +
      libraryItems.map(it =>
        `<option value="${escAttr(it.id)}">${escHtml(it.name)}</option>`
      ).join("");
    if (current) selectItemId.value = current;
  }

  async function saveItem(payload) {
    const url = editingId ? `/admin/shop/items/${editingId}` : "/admin/shop/items";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: apiHeaders(), body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.status === "ok") {
      window.logActivity && window.logActivity(`✅ 商品已${editingId ? "更新" : "新增"}：${json.data.name}`);
      await loadItems();
      resetForm();
    } else {
      window.logActivity && window.logActivity("❌ 儲存失敗：" + (json.message || ""));
    }
  }

  async function deleteItem(id, name) {
    if (!confirm(`確定要刪除「${name}」？`)) return;
    const res = await fetch(`/admin/shop/items/${id}`, { method: "DELETE", headers: apiHeaders() });
    const json = await res.json();
    if (json.status === "ok") {
      window.logActivity && window.logActivity(`🗑️ 商品已刪除：${name}`);
      await loadItems();
    } else {
      window.logActivity && window.logActivity("❌ 刪除失敗：" + (json.message || ""));
    }
  }

  async function toggleEnabled(item) {
    const res = await fetch(`/admin/shop/items/${item.id}`, {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify({ enabled: !item.enabled })
    });
    const json = await res.json();
    if (json.status === "ok") {
      await loadItems();
    }
  }

  // ── Render ────────────────────────────────────────────────
  function renderTable() {
    if (!tableBody) return;
    if (!shopItems.length) {
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted)">尚無商品，點右上「新增商品」開始上架。</td></tr>`;
      return;
    }
    tableBody.innerHTML = shopItems.map((item) => {
      const stockDisplay = item.stock === -1 ? "無限" : item.stock;
      const eff = item.effect || { type: "none", value: 0 };
      const effLabel = eff.type === "none"
        ? `<span style="color:var(--muted);font-size:0.8em">無效果</span>`
        : `<span class="badge badge-orange">${effectLabels[eff.type] || eff.type}${eff.value > 0 ? " " + eff.value : ""}</span>`;
      const enabledBadge = item.enabled
        ? `<span class="badge badge-green">上架</span>`
        : `<span class="badge badge-grey">下架</span>`;
      const saleBadge = item.isSale ? `<span class="badge badge-orange">優惠</span>` : "";
      const roleBadge = (item.allowedTiers || []).length
        ? `<span class="badge badge-orange" title="${escAttr((item.allowedTiers || []).join(", "))}">🔒 ${item.allowedTiers.join("/")}級</span>`
        : "";
      const monthBadge = item.maxPerMonth > 0
        ? `<span style="font-size:0.8em;color:var(--muted)">每月限 ${item.maxPerMonth}</span>`
        : "";
      const priceLabel = item.price === 0 ? `<span class="badge badge-green">免費</span>` : item.price;
      const thumb = item.imageUrl
        ? `<img src="${escAttr(item.imageUrl)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;vertical-align:middle;" />`
        : `<span style="display:inline-block;width:36px;height:36px;background:var(--surface-hover);border-radius:4px;vertical-align:middle;"></span>`;
      return `
        <tr>
          <td>${thumb}</td>
          <td>${escHtml(item.name)}${saleBadge}</td>
          <td style="max-width:200px;font-size:0.85em;">${escHtml(item.description)}</td>
          <td>${priceLabel} ${roleBadge} ${monthBadge}</td>
          <td>${currencyLabels[item.currency] || item.currency}</td>
          <td>${stockDisplay}</td>
          <td>${effLabel}</td>
          <td>${enabledBadge}</td>
          <td>
            <button class="button small" onclick="shopUI.edit('${item.id}')">編輯</button>
            <button class="button small" onclick="shopUI.toggleEnabled('${item.id}')">${item.enabled ? "下架" : "上架"}</button>
            <button class="button small danger" onclick="shopUI.delete('${item.id}','${escAttr(item.name)}')">刪除</button>
          </td>
        </tr>`;
    }).join("");
  }

  function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return String(s || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ── Item preview card ─────────────────────────────────────
  function showPreview(item) {
    if (!previewCard || !item) { hidePreview(); return; }
    previewName.textContent = item.name || "";
    previewDesc.textContent = item.description || "";
    const eff = item.effect || { type: "none", value: 0 };
    if (eff.type && eff.type !== "none") {
      previewEff.textContent = `${effectLabels[eff.type] || eff.type}${eff.value > 0 ? " " + eff.value : ""}`;
      previewEff.style.display = "inline";
    } else {
      previewEff.style.display = "none";
    }
    if (item.imageUrl) {
      previewImg.src = item.imageUrl;
      previewImg.style.display = "block";
    } else {
      previewImg.src = "";
      previewImg.style.display = "none";
    }
    previewCard.style.display = "flex";
  }

  function hidePreview() {
    if (previewCard) previewCard.style.display = "none";
  }

  // ── Form ──────────────────────────────────────────────────
  function showForm() {
    formArea.classList.remove("hidden");
    formArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function resetForm() {
    editingId = null;
    if (formTitle) formTitle.textContent = "新增商品";
    if (btnSubmit) btnSubmit.textContent = "新增";
    if (selectItemId) selectItemId.value = "";
    hidePreview();
    if (inputPrice) inputPrice.value = "100";
    if (inputCurrency) inputCurrency.value = "gold";
    if (inputStock) inputStock.value = "-1";
    if (inputMaxPerMonth) inputMaxPerMonth.value = "0";
    renderTierCheckboxes([]);
    if (inputEnabled) inputEnabled.checked = true;
    if (inputIsSale) inputIsSale.checked = false;
    formArea.classList.add("hidden");
  }

  function fillForm(item) {
    editingId = item.id;
    if (formTitle) formTitle.textContent = "編輯商品";
    if (btnSubmit) btnSubmit.textContent = "儲存";
    if (selectItemId) {
      selectItemId.value = item.itemLibraryId || "";
    }
    // 顯示 preview（使用 shopItem 現有資料，不必重新 fetch）
    showPreview({ name: item.name, description: item.description, effect: item.effect, imageUrl: item.imageUrl });
    if (inputPrice) inputPrice.value = item.price;
    if (inputCurrency) inputCurrency.value = item.currency;
    if (inputStock) inputStock.value = item.stock;
    if (inputMaxPerMonth) inputMaxPerMonth.value = item.maxPerMonth || 0;
    // 等級框需先確保資料，再繪
    ensureTiersLoaded().then(() => renderTierCheckboxes(item.allowedTiers || []));
    if (inputEnabled) inputEnabled.checked = item.enabled;
    if (inputIsSale) inputIsSale.checked = Boolean(item.isSale);
    showForm();
  }

  async function ensureTiersLoaded() {
    // 如果 playerTiers 還是空的，主動乾一次
    if (!window.playerTiers || Object.keys(window.playerTiers).length === 0) {
      try {
        const res = await fetch("/admin/player-tiers", { headers: apiHeaders() });
        const json = await res.json();
        if (json.status === "ok") window.playerTiers = json.data || {};
      } catch { /* ignore */ }
    }
  }

  // ── Events ──────────────────────────────────────────────────
  if (btnNew) {
    btnNew.addEventListener("click", async () => {
      resetForm();
      await Promise.all([loadLibraryItems(), ensureTiersLoaded()]);
      renderTierCheckboxes([]);  // 載入完再繪一次
      showForm();
    });
  }

  if (btnCancel) btnCancel.addEventListener("click", () => resetForm());

  if (selectItemId) {
    selectItemId.addEventListener("change", () => {
      const chosen = libraryItems.find(it => it.id === selectItemId.value);
      if (chosen) showPreview(chosen);
      else hidePreview();
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const itemLibraryId = selectItemId ? selectItemId.value : "";
      if (!itemLibraryId) { alert("請從道具庫選擇道具"); return; }
      const payload = {
        itemLibraryId,
        price: Number(inputPrice.value),
        currency: inputCurrency.value,
        stock: Number(inputStock.value),
        maxPerMonth: Number(inputMaxPerMonth ? inputMaxPerMonth.value : 0),
        allowedTiers: getSelectedTiers(),
        enabled: inputEnabled.checked,
        isSale: inputIsSale ? inputIsSale.checked : false
      };
      await saveItem(payload);
    });
  }

  // ── Public API ─────────────────────────────────────────────
  window.shopUI = {
    edit(id) { const item = shopItems.find((i) => i.id === id); if (item) fillForm(item); },
    delete(id, name) { deleteItem(id, name); },
    toggleEnabled(id) { const item = shopItems.find((i) => i.id === id); if (item) toggleEnabled(item); },
    reload: loadItems
  };

  // ── Init ──────────────────────────────────────────────────
  document.addEventListener("adminConnected", () => {
    loadItems();
    loadLibraryItems();
    renderTierCheckboxes([]);
  });

  // tier 設定更新時，永遠重繪 checkboxes（保留已勾選狀態）
  document.addEventListener("playerTiersLoaded", () => {
    renderTierCheckboxes(getSelectedTiers());
  });
})();

