/* admin.items.js — 道具庫管理 */
(function () {
  let items = [];
  let editingId = null;

  const typeLabels = {
    consumable: { text: "🧪 消耗品", style: "color:#60a5fa;font-size:0.8em" },
    collectible: { text: "🖼️ 圖片",   style: "color:#fb923c;font-size:0.8em" },
    equipment:   { text: "⚔️ 裝備",   style: "color:#4ade80;font-size:0.8em" }
  };

  const effectLabels = {
    none: "無效果",
    grant_gold: "💰 給予金幣",
    grant_diamond: "💎 給予鑽石",
    grant_exp: "✨ 給予經驗值",
    grant_status_points: "📊 給予屬性點",
    checkin_multiplier: "🎯 打卡加倍符"
  };

  // ── DOM refs ──────────────────────────────────────────────
  const tableBody   = document.getElementById("items-tbody");
  const form        = document.getElementById("items-form");
  const formTitle   = document.getElementById("items-form-title");
  const formArea    = document.getElementById("items-form-area");
  const inputName   = document.getElementById("items-input-name");
  const inputDesc   = document.getElementById("items-input-desc");
  const inputItemType   = document.getElementById("items-input-type");
  const inputEffectType  = document.getElementById("items-input-effect-type");
  const inputEffectValue = document.getElementById("items-input-effect-value");
  const inputImage  = document.getElementById("items-input-image");
  const imagePreview = document.getElementById("items-image-preview");
  const btnSubmit   = document.getElementById("items-btn-submit");
  const btnCancel   = document.getElementById("items-btn-cancel");
  const btnNew      = document.getElementById("items-btn-new");

  // ── API helpers ───────────────────────────────────────────
  function apiHeaders() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` };
  }

  async function loadItems() {
    const res = await fetch("/admin/items", { headers: apiHeaders() });
    const json = await res.json();
    if (json.status === "ok") {
      items = json.data || [];
      renderTable();
    } else {
      window.logActivity && window.logActivity("❌ 無法載入道具庫：" + (json.message || ""));
    }
  }

  async function saveItem(payload) {
    const url    = editingId ? `/admin/items/${editingId}` : "/admin/items";
    const method = editingId ? "PUT" : "POST";
    const res    = await fetch(url, { method, headers: apiHeaders(), body: JSON.stringify(payload) });
    const json   = await res.json();
    if (json.status === "ok") {
      const savedItem = json.data;
      window.logActivity && window.logActivity(`✅ 道具已${editingId ? "更新" : "新增"}：${payload.name}`);
      // 若有選擇圖片，上傳
      if (inputImage && inputImage.files && inputImage.files[0]) {
        await uploadImage(savedItem.id, inputImage.files[0]);
      } else {
        await loadItems();
        resetForm();
      }
    } else {
      window.logActivity && window.logActivity("❌ 儲存失敗：" + (json.message || ""));
    }
  }

  async function uploadImage(id, file) {
    const fd = new FormData();
    fd.append("image", file);
    const res  = await fetch(`/admin/items/${id}/image`, { method: "POST", headers: { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` }, body: fd });
    const json = await res.json();
    if (json.status === "ok") {
      window.logActivity && window.logActivity("🖼️ 圖片上傳成功");
    } else {
      window.logActivity && window.logActivity("❌ 圖片上傳失敗：" + (json.message || ""));
    }
    await loadItems();
    resetForm();
  }

  async function deleteItem(id, name) {
    if (!confirm(`確定要刪除道具「${name}」？`)) return;
    const res  = await fetch(`/admin/items/${id}`, { method: "DELETE", headers: apiHeaders() });
    const json = await res.json();
    if (json.status === "ok") {
      window.logActivity && window.logActivity(`🗑️ 道具已刪除：${name}`);
      await loadItems();
    } else {
      window.logActivity && window.logActivity("❌ 刪除失敗：" + (json.message || ""));
    }
  }

  // ── Render ────────────────────────────────────────────────
  function renderTable() {
    if (!tableBody) return;
    if (!items.length) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted)">尚無道具，點右上「新增道具」開始建立。</td></tr>`;
      return;
    }
    tableBody.innerHTML = items.map((item) => {
      const tl = typeLabels[item.itemType] || typeLabels.consumable;
      const typeCell = `<span style="${tl.style}">${tl.text}</span>`;
      const eff = item.effect || { type: "none", value: 0 };
      const effLabel = eff.type === "none"
        ? `<span style="color:var(--muted);font-size:0.8em">無效果</span>`
        : `<span class="badge badge-orange">${effectLabels[eff.type] || eff.type}${eff.value > 0 ? " " + eff.value : ""}</span>`;
      const img = item.imageUrl
        ? `<img src="${escHtml(item.imageUrl)}" style="height:40px;width:40px;object-fit:cover;border-radius:6px;vertical-align:middle;" />`
        : `<span style="color:var(--muted);font-size:0.8em">無圖片</span>`;
      return `<tr>
        <td>${img}</td>
        <td><strong>${escHtml(item.name)}</strong></td>
        <td>${typeCell}</td>
        <td style="font-size:0.85em;max-width:200px;">${escHtml(item.description)}</td>
        <td>${effLabel}</td>
        <td>
          <button class="button small" onclick="itemsUI.edit('${item.id}')">編輯</button>
          <button class="button small danger" onclick="itemsUI.delete('${item.id}','${escAttr(item.name)}')">刪除</button>
        </td>
      </tr>`;
    }).join("");
  }

  function escHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return String(s || "").replace(/'/g, "\\'"); }

  // ── Form ──────────────────────────────────────────────────
  function showForm() {
    formArea.classList.remove("hidden");
    formArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function resetForm() {
    editingId = null;
    if (formTitle) formTitle.textContent = "新增道具";
    if (btnSubmit) btnSubmit.textContent = "新增";
    if (inputName) inputName.value = "";
    if (inputDesc) inputDesc.value = "";
    if (inputItemType) inputItemType.value = "consumable";
    if (inputEffectType) inputEffectType.value = "none";
    if (inputEffectValue) inputEffectValue.value = "0";
    if (inputImage) inputImage.value = "";
    if (imagePreview) { imagePreview.src = ""; imagePreview.classList.add("hidden"); }
    if (formArea) formArea.classList.add("hidden");
  }

  function fillForm(item) {
    editingId = item.id;
    if (formTitle) formTitle.textContent = "編輯道具";
    if (btnSubmit) btnSubmit.textContent = "儲存";
    if (inputName) inputName.value = item.name;
    if (inputDesc) inputDesc.value = item.description;
    if (inputItemType) inputItemType.value = item.itemType || "consumable";
    if (inputEffectType) inputEffectType.value = (item.effect && item.effect.type) || "none";
    if (inputEffectValue) inputEffectValue.value = (item.effect && item.effect.value) || 0;
    if (inputImage) inputImage.value = "";
    if (imagePreview) {
      if (item.imageUrl) {
        imagePreview.src = item.imageUrl;
        imagePreview.classList.remove("hidden");
      } else {
        imagePreview.src = "";
        imagePreview.classList.add("hidden");
      }
    }
    showForm();
  }

  // ── Events ────────────────────────────────────────────────
  if (btnNew)    btnNew.addEventListener("click", () => { resetForm(); showForm(); });
  if (btnCancel) btnCancel.addEventListener("click", () => resetForm());

  if (inputImage) {
    inputImage.addEventListener("change", () => {
      const file = inputImage.files[0];
      if (file && imagePreview) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.classList.remove("hidden");
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        name: inputName.value.trim(),
        description: inputDesc.value.trim(),
        itemType: inputItemType ? inputItemType.value : "consumable",
        effect: {
          type: inputEffectType ? inputEffectType.value : "none",
          value: inputEffectValue ? Number(inputEffectValue.value) : 0
        }
      };
      if (!payload.name) { alert("請輸入道具名稱"); return; }
      await saveItem(payload);
    });
  }

  // ── Public API ────────────────────────────────────────────
  window.itemsUI = {
    edit(id)         { const item = items.find((i) => i.id === id); if (item) fillForm(item); },
    delete(id, name) { deleteItem(id, name); },
    getAll()         { return items; },
    reload:          loadItems
  };

  document.addEventListener("adminConnected", () => { loadItems(); });
})();
