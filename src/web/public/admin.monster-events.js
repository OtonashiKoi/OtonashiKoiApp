(function () {
  const BASE = "/admin/monster-events";
  const listEl = document.getElementById("monster-events-list");
  const refreshBtn = document.getElementById("monster-events-refresh-btn");
  const addBtn = document.getElementById("monster-events-add-btn");
  const npcImgInput = document.getElementById("monster-events-npc-img-input");
  if (!listEl) return;

  const TEXT = {
    loading: "載入中...",
    loadEmpty: "目前沒有 NPC 模板，點「新增模板」建立第一個。",
    loadFailed: "載入失敗：",
    edit: "編輯",
    delete: "刪除",
    enabled: "啟用",
    disabled: "停用",
    zoneNormal: "一般區",
    zoneMid: "中級區",
    triggerAny: "任何怪物",
    triggerSeq: "怪物序號",
    optionsCount: "選項數",
    updatedAt: "更新時間",
    createSuccess: "已新增 NPC 模板",
    createFailed: "新增失敗：",
    saveSuccess: "已儲存 NPC 模板 ",
    saveFailed: "儲存失敗：",
    deleteSuccess: "已刪除 NPC 模板 ",
    deleteFailed: "刪除失敗：",
    confirmDelete: "確定要刪除此 NPC 模板？",
    uploadSuccess: "已更新 NPC 圖片 ",
    uploadFailed: "上傳失敗：",
    clearImageFailed: "清除圖片失敗：",
    modalTitle: "NPC 模板編輯",
    close: "關閉",
    save: "儲存模板",
    templateName: "模板名稱",
    zone: "區域",
    priority: "優先序",
    durationSec: "事件停留秒數",
    triggerMonsterSeq: "觸發怪物序號（空白=任何）",
    npcSettings: "NPC 設定",
    npcName: "NPC 名稱",
    npcImageMissing: "尚未設定圖片",
    uploadImage: "上傳圖片",
    clearImage: "清除圖片",
    openingLine: "開場台詞",
    openingLinePlaceholder: "NPC 出現後先說的話",
    optionsTitle: "玩家選項與效果",
    addOption: "＋ 新增選項",
    option: "選項",
    optionLabel: "玩家看到的文字",
    optionReply: "玩家選後 NPC 回覆",
    optionDelete: "刪除選項",
    effectEditor: "效果設定",
    mysteryNpc: "神秘 NPC",
    newTemplateName: "新 NPC 模板",
    helloAdventurer: "你好，冒險者。",
    rewardLabel: "領取 100 金幣",
    rewardReply: "這是你的獎勵。"
  };

  let templates = [];
  let activeTemplateId = null;
  let pendingUploadTemplateId = null;
  const modalRoot = buildModalRoot();

  function headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}`
    };
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${res.status}`);
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

  function zoneLabel(zone) {
    return zone === "mid" ? TEXT.zoneMid : TEXT.zoneNormal;
  }

  function getStartNode(template) {
    if (Array.isArray(template?.nodes) && template.nodes.length) {
      return template.nodes.find((node) => node.id === "start") || template.nodes[0];
    }
    return { id: "start", text: template?.message || "", options: [] };
  }

  function cardHtml(template) {
    const npc = template.npc || {};
    const img = npc.imageThumbnailUrl || npc.imageUrl || "";
    const startNode = getStartNode(template);
    const options = Array.isArray(startNode.options) ? startNode.options : [];
    const triggerText = template.triggerMonsterSeq == null ? TEXT.triggerAny : `${TEXT.triggerSeq} #${template.triggerMonsterSeq}`;
    const updatedText = template.updatedAt ? new Date(template.updatedAt).toLocaleString("zh-TW") : "-";

    return `
      <article class="access-card monster-event-card" data-id="${esc(template.id)}" style="display:grid;gap:10px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">
          <div style="display:flex;gap:10px;min-width:0;">
            <div style="width:56px;height:56px;border:1px solid var(--line-strong);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface);flex:0 0 auto;">
              ${img ? `<img src="${esc(img)}" alt="npc" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:20px;">🧙</span>`}
            </div>
            <div style="min-width:0;">
              <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(template.name || TEXT.newTemplateName)}</div>
              <div class="hint" style="margin-top:2px;">${esc(npc.name || TEXT.mysteryNpc)}</div>
              <div class="hint" style="margin-top:4px;">ID: ${esc((template.id || "").slice(0, 8))}</div>
            </div>
          </div>
          <label style="display:flex;gap:6px;align-items:center;white-space:nowrap;">
            <input type="checkbox" data-action="toggle-enabled" ${template.enabled ? "checked" : ""}/>
            <span>${template.enabled ? TEXT.enabled : TEXT.disabled}</span>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;" class="hint">
          <div>區域：${esc(zoneLabel(template.zone))}</div>
          <div>優先序：${Number(template.priority) || 0}</div>
          <div>觸發：${esc(triggerText)}</div>
          <div>${TEXT.optionsCount}：${options.length}</div>
          <div style="grid-column:1 / -1;">${TEXT.updatedAt}：${esc(updatedText)}</div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="button" data-action="edit">${TEXT.edit}</button>
          <button class="button danger" data-action="delete">${TEXT.delete}</button>
        </div>
      </article>
    `;
  }

  function renderCards() {
    if (!templates.length) {
      listEl.innerHTML = `<p class="hint">${TEXT.loadEmpty}</p>`;
      return;
    }
    listEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">${templates.map(cardHtml).join("")}</div>`;
  }

  async function load({ openId = null } = {}) {
    listEl.innerHTML = `<p class="hint">${TEXT.loading}</p>`;
    try {
      templates = await api(`${BASE}?includeDisabled=1`);
      renderCards();
      if (openId) openEditor(openId);
    } catch (error) {
      listEl.innerHTML = `<p class="hint" style="color:var(--danger);">${TEXT.loadFailed}${esc(error.message)}</p>`;
    }
  }

  function optionRowHtml(option, index) {
    const effects = Array.isArray(option.effects) ? option.effects : [];
    const encodedEffects = window.adminEffects ? window.adminEffects.encodeState(effects) : "";
    const summary = window.adminEffects ? window.adminEffects.summarizeNpcEffects(effects) : `${effects.length} effects`;
    return `
      <div class="npc-option-row" data-option-index="${index}" style="border:1px dashed var(--line-strong);border-radius:8px;padding:10px;display:grid;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${TEXT.option} ${index + 1}</strong>
          <button type="button" class="button danger" data-action="delete-option">${TEXT.optionDelete}</button>
        </div>
        <input class="sheet-input" data-opt-field="label" placeholder="${TEXT.optionLabel}" value="${esc(option.label || "")}" />
        <textarea class="sheet-input" data-opt-field="npcReply" rows="2" placeholder="${TEXT.optionReply}">${esc(option.npcReply || "")}</textarea>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="hidden" data-opt-field="effectsData" value="${esc(encodedEffects)}" />
          <button type="button" class="button" data-action="edit-option-effects">${TEXT.effectEditor}</button>
          <span class="hint npc-option-effects-summary">${esc(summary)}</span>
        </div>
      </div>
    `;
  }

  function editorHtml(template) {
    const npc = template.npc || {};
    const startNode = getStartNode(template);
    const options = Array.isArray(startNode.options) ? startNode.options : [];
    const triggerSeq = template.triggerMonsterSeq == null ? "" : template.triggerMonsterSeq;
    const npcImg = npc.imageThumbnailUrl || npc.imageUrl || "";
    return `
      <div style="background:var(--surface-strong);border:1px solid var(--line-strong);border-radius:14px;padding:14px;display:grid;gap:12px;max-height:86vh;overflow:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <h3 style="margin:0;">${TEXT.modalTitle}</h3>
          <button type="button" class="button" data-action="close-modal">${TEXT.close}</button>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px;">
          <label><span>${TEXT.templateName}</span><input class="sheet-input" data-field="name" value="${esc(template.name || "")}" /></label>
          <label><span>${TEXT.zone}</span><select class="sheet-input" data-field="zone"><option value="normal" ${template.zone === "normal" ? "selected" : ""}>${TEXT.zoneNormal}</option><option value="mid" ${template.zone === "mid" ? "selected" : ""}>${TEXT.zoneMid}</option></select></label>
          <label><span>${TEXT.priority}</span><input class="sheet-input" data-field="priority" type="number" min="0" step="1" value="${Number(template.priority) || 0}" /></label>
          <label style="display:flex;align-items:flex-end;gap:6px;"><input type="checkbox" data-field="enabled" ${template.enabled ? "checked" : ""}/><span>${TEXT.enabled}</span></label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label><span>${TEXT.triggerMonsterSeq}</span><input class="sheet-input" data-field="triggerMonsterSeq" type="number" min="1" step="1" value="${esc(triggerSeq)}" /></label>
          <label><span>${TEXT.durationSec}</span><input class="sheet-input" data-field="durationSec" type="number" min="1" max="600" step="1" value="${Number(template.durationSec) || 12}" /></label>
        </div>

        <div style="display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start;">
          <div class="access-card" style="padding:10px;display:grid;gap:8px;">
            <strong>${TEXT.npcSettings}</strong>
            <input class="sheet-input" data-field="npcName" placeholder="${TEXT.npcName}" value="${esc(npc.name || "")}" />
            <div style="height:140px;border:1px solid var(--line-strong);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface);">
              ${npcImg ? `<img src="${esc(npcImg)}" alt="npc" style="max-width:100%;max-height:100%;object-fit:contain;"/>` : `<span class="hint">${TEXT.npcImageMissing}</span>`}
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="button" data-action="upload-image">${TEXT.uploadImage}</button>
              <button type="button" class="button" data-action="clear-image">${TEXT.clearImage}</button>
            </div>
          </div>

          <label style="display:grid;gap:6px;">
            <span>${TEXT.openingLine}</span>
            <textarea class="sheet-input" data-field="startText" rows="6" placeholder="${TEXT.openingLinePlaceholder}">${esc(startNode.text || "")}</textarea>
          </label>
        </div>

        <div style="display:grid;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${TEXT.optionsTitle}</strong>
            <button type="button" class="button" data-action="add-option">${TEXT.addOption}</button>
          </div>
          <div class="npc-options-list" style="display:grid;gap:8px;">
            ${options.length ? options.map(optionRowHtml).join("") : ""}
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="button primary" data-action="save-template">${TEXT.save}</button>
        </div>
      </div>
    `;
  }

  function buildModalRoot() {
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;background:#000;display:none;align-items:flex-start;justify-content:center;padding:18px;z-index:1000;overflow:auto;";
    root.innerHTML = '<div style="width:min(1100px,96vw);max-height:92vh;overflow:auto;margin-top:28px;background:var(--surface-strong);border-radius:12px;padding:12px;"></div>';
    document.body.appendChild(root);
    root.addEventListener("click", (event) => {
      if (event.target === root) closeEditor();
    });
    return root;
  }

  function closeEditor() {
    activeTemplateId = null;
    modalRoot.style.display = "none";
    modalRoot.firstElementChild.innerHTML = "";
  }

  function openEditor(id) {
    const template = templates.find((entry) => entry.id === id);
    if (!template) return;
    activeTemplateId = id;
    modalRoot.firstElementChild.innerHTML = editorHtml(template);
    modalRoot.style.display = "flex";
  }

  function readEditorPayload() {
    const id = activeTemplateId;
    const template = templates.find((entry) => entry.id === id);
    if (!template) return null;
    const panel = modalRoot.firstElementChild;
    const field = (name) => panel.querySelector(`[data-field="${name}"]`);
    const rawSeq = String(field("triggerMonsterSeq")?.value || "").trim();
    const optionRows = [...panel.querySelectorAll(".npc-option-row")];
    const options = optionRows.map((row, idx) => {
      const get = (name) => row.querySelector(`[data-opt-field="${name}"]`);
      return {
        id: `opt_${idx + 1}`,
        label: String(get("label")?.value || "").trim() || `${TEXT.option} ${idx + 1}`,
        npcReply: String(get("npcReply")?.value || "").trim(),
        nextNodeId: null,
        effects: window.adminEffects ? window.adminEffects.decodeState(get("effectsData")?.value, []) : []
      };
    });

    return {
      enabled: Boolean(field("enabled")?.checked),
      name: String(field("name")?.value || "").trim() || TEXT.newTemplateName,
      zone: field("zone")?.value === "mid" ? "mid" : "normal",
      triggerMonsterSeq: rawSeq ? Number(rawSeq) : null,
      priority: Number(field("priority")?.value || 0),
      durationSec: Number(field("durationSec")?.value || 12),
      message: String(field("startText")?.value || "").trim(),
      npc: {
        name: String(field("npcName")?.value || "").trim() || TEXT.mysteryNpc,
        imageUrl: template.npc?.imageUrl || null,
        imageThumbnailUrl: template.npc?.imageThumbnailUrl || null
      },
      nodes: [{ id: "start", text: String(field("startText")?.value || "").trim(), options }]
    };
  }

  async function createTemplate() {
    try {
      const created = await api(BASE, {
        method: "POST",
        body: JSON.stringify({
          name: TEXT.newTemplateName,
          zone: "normal",
          triggerMonsterSeq: null,
          durationSec: 12,
          priority: 100,
          enabled: true,
          npc: { name: TEXT.mysteryNpc, imageUrl: null, imageThumbnailUrl: null },
          message: TEXT.helloAdventurer,
          nodes: [{
            id: "start",
            text: TEXT.helloAdventurer,
            options: [{
              id: "opt_1",
              label: TEXT.rewardLabel,
              npcReply: TEXT.rewardReply,
              nextNodeId: null,
              effects: [{ type: "grant_currency", payload: { currencyType: "gold", amount: 100 } }]
            }]
          }]
        })
      });
      window.logActivity?.(TEXT.createSuccess);
      await load({ openId: created?.id || null });
    } catch (error) {
      alert(`${TEXT.createFailed}${error.message}`);
    }
  }

  async function saveCurrentEditor() {
    const id = activeTemplateId;
    if (!id) return;
    try {
      const payload = readEditorPayload();
      if (!payload) return;
      await api(`${BASE}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
      window.logActivity?.(`${TEXT.saveSuccess}${id.slice(0, 8)}`);
      await load({ openId: id });
    } catch (error) {
      alert(`${TEXT.saveFailed}${error.message}`);
    }
  }

  async function deleteTemplate(id) {
    if (!id || !confirm(TEXT.confirmDelete)) return;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
      closeEditor();
      window.logActivity?.(`${TEXT.deleteSuccess}${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`${TEXT.deleteFailed}${error.message}`);
    }
  }

  function addOptionInEditor() {
    const list = modalRoot.querySelector(".npc-options-list");
    if (!list) return;
    const idx = list.querySelectorAll(".npc-option-row").length;
    list.insertAdjacentHTML("beforeend", optionRowHtml({ label: `${TEXT.option} ${idx + 1}`, npcReply: "", effects: [] }, idx));
  }

  function uploadNpcImage(id) {
    if (!id || !npcImgInput) return;
    pendingUploadTemplateId = id;
    npcImgInput.value = "";
    npcImgInput.click();
  }

  async function clearNpcImage() {
    const id = activeTemplateId;
    if (!id) return;
    const payload = readEditorPayload();
    if (!payload) return;
    payload.npc.imageUrl = null;
    payload.npc.imageThumbnailUrl = null;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
      await load({ openId: id });
    } catch (error) {
      alert(`${TEXT.clearImageFailed}${error.message}`);
    }
  }

  listEl.addEventListener("click", async (event) => {
    const card = event.target.closest(".monster-event-card");
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;

    if (event.target.closest('[data-action="edit"]')) {
      openEditor(id);
      return;
    }
    if (event.target.closest('[data-action="delete"]')) {
      deleteTemplate(id);
    }
  });

  listEl.addEventListener("change", async (event) => {
    const toggle = event.target.closest('[data-action="toggle-enabled"]');
    if (!toggle) return;
    const card = toggle.closest(".monster-event-card");
    const id = card?.dataset.id;
    if (!id) return;
    const current = templates.find((entry) => entry.id === id);
    if (!current) return;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...current, enabled: Boolean(toggle.checked) })
      });
      await load();
    } catch (error) {
      alert(`${TEXT.saveFailed}${error.message}`);
    }
  });

  modalRoot.addEventListener("click", async (event) => {
    if (event.target.closest('[data-action="close-modal"]')) {
      closeEditor();
      return;
    }
    if (event.target.closest('[data-action="save-template"]')) {
      saveCurrentEditor();
      return;
    }
    if (event.target.closest('[data-action="add-option"]')) {
      addOptionInEditor();
      return;
    }
    if (event.target.closest('[data-action="delete-option"]')) {
      event.target.closest(".npc-option-row")?.remove();
      return;
    }
    if (event.target.closest('[data-action="upload-image"]')) {
      uploadNpcImage(activeTemplateId);
      return;
    }
    if (event.target.closest('[data-action="clear-image"]')) {
      clearNpcImage();
      return;
    }
    if (event.target.closest('[data-action="edit-option-effects"]')) {
      if (!window.adminEffects) {
        alert('效果編輯器尚未載入');
        return;
      }
      if (!window.getAdminToken || !window.getAdminToken()) {
        alert('請先在後台連線（輸入管理員金鑰）後再編輯效果');
        return;
      }
      const row = event.target.closest(".npc-option-row");
      const hidden = row?.querySelector('[data-opt-field="effectsData"]');
      try {
        await window.adminEffects.ensureLookups();
        const effects = window.adminEffects.decodeState(hidden?.value, []);
        window.adminEffects.openNpcOptionEditor(effects, (nextEffects) => {
          if (hidden) hidden.value = window.adminEffects.encodeState(nextEffects);
          const summary = row?.querySelector(".npc-option-effects-summary");
          if (summary) summary.textContent = window.adminEffects.summarizeNpcEffects(nextEffects);
        });
      } catch (error) {
        alert(error.message || String(error));
      }
    }
  });

  npcImgInput?.addEventListener("change", async () => {
    const file = npcImgInput.files?.[0];
    const id = pendingUploadTemplateId;
    if (!file || !id) return;
    const form = new FormData();
    form.append("image", file);

    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}/npc-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` },
        body: form
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${res.status}`);
      window.logActivity?.(`${TEXT.uploadSuccess}${id.slice(0, 8)}`);
      await load({ openId: activeTemplateId || id });
    } catch (error) {
      alert(`${TEXT.uploadFailed}${error.message}`);
    } finally {
      pendingUploadTemplateId = null;
      npcImgInput.value = "";
    }
  });

  refreshBtn?.addEventListener("click", () => load());
  addBtn?.addEventListener("click", createTemplate);

  window.addEventListener("load", () => {
    if (window.getAdminToken?.()) load();
  });
})();
