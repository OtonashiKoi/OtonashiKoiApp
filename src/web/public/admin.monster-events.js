(function () {
  const BASE = "/admin/monster-events";
  const listEl = document.getElementById("monster-events-list");
  const refreshBtn = document.getElementById("monster-events-refresh-btn");
  const addBtn = document.getElementById("monster-events-add-btn");
  const npcImgInput = document.getElementById("monster-events-npc-img-input");
  if (!listEl) return;

  const TEXT = {
    template: "\u6a21\u677f",
    enabled: "\u555f\u7528",
    templateName: "\u6a21\u677f\u540d\u7a31",
    normalZone: "\u4e00\u822c\u5340",
    midZone: "\u4e2d\u7d1a\u5340",
    triggerMonsterSeq: "\u89f8\u767c\u602a\u5e8f",
    npcSettings: "NPC \u8a2d\u5b9a",
    npcName: "NPC \u540d\u7a31",
    npcImageMissing: "\u5c1a\u672a\u8a2d\u5b9a\u5716\u7247",
    uploadImage: "\u4e0a\u50b3\u5716\u7247",
    clear: "\u6e05\u9664",
    openingLine: "\u958b\u5834\u53f0\u8a5e",
    openingLinePlaceholder: "NPC \u51fa\u73fe\u5f8c\u5148\u8aaa\u7684\u8a71",
    durationSec: "\u4e8b\u4ef6\u4fdd\u7559\u79d2\u6578\uff08\u4f9b\u602a\u7269\u5207\u63db\u7b49\u5f85\uff09",
    optionsAndEffects: "\u9078\u9805\u8207\u6548\u679c",
    addOption: "\uff0b \u65b0\u589e\u9078\u9805",
    noOptions: "\u5c1a\u7121\u9078\u9805\uff0c\u8acb\u65b0\u589e\u3002",
    effectExamples: "\u6548\u679c\u7bc4\u4f8b\uff08\u9ede\u958b\u53ef\u8907\u88fd\uff09",
    saveTemplate: "\u5132\u5b58\u6a21\u677f",
    deleteTemplate: "\u522a\u9664\u6a21\u677f",
    loadEmpty: "\u76ee\u524d\u6c92\u6709 NPC \u6a21\u677f\uff0c\u9ede\u300c\u65b0\u589e\u6a21\u677f\u300d\u5efa\u7acb\u7b2c\u4e00\u500b\u3002",
    loading: "\u8f09\u5165\u4e2d...",
    loadFailed: "\u8f09\u5165\u5931\u6557\uff1a",
    option: "\u9078\u9805",
    deleteOption: "\u522a\u9664\u9078\u9805",
    optionLabelPlaceholder: "\u73a9\u5bb6\u770b\u5230\u7684\u9078\u9805\u6587\u5b57",
    npcReplyPlaceholder: "\u73a9\u5bb6\u9078\u9019\u500b\u9078\u9805\u5f8c\uff0cNPC \u8981\u8aaa\u7684\u8a71",
    effectsEditor: "\u6548\u679c\u8a2d\u5b9a",
    createName: "\u65b0 NPC \u6a21\u677f",
    mysteryNpc: "\u795e\u79d8 NPC",
    helloAdventurer: "\u4f60\u597d\uff0c\u5192\u96aa\u8005\u3002",
    grant100Gold: "\u9818\u53d6 100 \u91d1\u5e63",
    yourReward: "\u9019\u662f\u4f60\u7684\u734e\u52f5\u3002",
    createSuccess: "\u5df2\u65b0\u589e NPC \u4e8b\u4ef6\u6a21\u677f",
    createFailed: "\u65b0\u589e\u5931\u6557\uff1a",
    saveSuccess: "\u5df2\u5132\u5b58 NPC \u6a21\u677f ",
    saveFailed: "\u5132\u5b58\u5931\u6557\uff1a",
    confirmDelete: "\u78ba\u5b9a\u8981\u522a\u9664\u6b64 NPC \u6a21\u677f\uff1f",
    deleteSuccess: "\u5df2\u522a\u9664 NPC \u6a21\u677f ",
    deleteFailed: "\u522a\u9664\u5931\u6557\uff1a",
    clearImageFailed: "\u6e05\u9664\u5716\u7247\u5931\u6557\uff1a",
    uploadSuccess: "\u5df2\u66f4\u65b0 NPC \u5716\u7247 ",
    uploadFailed: "\u4e0a\u50b3\u5931\u6557\uff1a"
  };

  let templates = [];
  let pendingUploadTemplateId = null;

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

  function getStartNode(template) {
    if (Array.isArray(template.nodes) && template.nodes.length) {
      return template.nodes.find((node) => node.id === "start") || template.nodes[0];
    }
    return { id: "start", text: template.message || "", options: [] };
  }

  function defaultEffectsSample() {
    return [
      { type: "grant_currency", payload: { currencyType: "gold", amount: 100 } },
      { type: "grant_item", payload: { itemId: "ITEM_ID", amount: 1 } },
      { type: "grant_equipment", payload: { itemId: "EQUIP_ID", enhanceLevel: 0 } },
      { type: "grant_temporary_quest", payload: { questId: "QUEST_ID", expiresInSec: 3600 } },
      { type: "grant_buff", payload: { buffId: "BUFF_ID", durationSec: 300, stacks: 1 } }
    ];
  }

  function optionRow(option, index) {
    const effects = Array.isArray(option.effects) ? option.effects : [];
    const encodedEffects = window.adminEffects ? window.adminEffects.encodeState(effects) : "";
    const effectSummary = window.adminEffects ? window.adminEffects.summarizeNpcEffects(effects) : `${effects.length} effects`;
    return `
      <div class="npc-option-row" data-option-index="${index}" style="border:1px dashed var(--line-strong);border-radius:8px;padding:10px;display:grid;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${TEXT.option} ${index + 1}</strong>
          <button class="button danger npc-option-delete" type="button">${TEXT.deleteOption}</button>
        </div>
        <input class="sheet-input" data-opt-field="label" placeholder="${TEXT.optionLabelPlaceholder}" value="${esc(option.label || "")}" />
        <textarea class="sheet-input" data-opt-field="npcReply" rows="2" placeholder="${TEXT.npcReplyPlaceholder}">${esc(option.npcReply || "")}</textarea>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="hidden" data-opt-field="effectsData" value="${esc(encodedEffects)}" />
          <button class="button npc-option-effects" type="button">${TEXT.effectsEditor}</button>
          <span class="hint npc-option-effects-summary">${esc(effectSummary)}</span>
        </div>
      </div>
    `;
  }

  function templateCard(template) {
    const triggerSeq = template.triggerMonsterSeq == null ? "" : template.triggerMonsterSeq;
    const npc = template.npc || { name: TEXT.mysteryNpc, imageUrl: null, imageThumbnailUrl: null };
    const startNode = getStartNode(template);
    const options = Array.isArray(startNode.options) ? startNode.options : [];
    const npcImage = npc.imageThumbnailUrl || npc.imageUrl || "";

    return `
      <article class="access-card monster-event-card" data-id="${esc(template.id)}" style="display:grid;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <strong>${TEXT.template} #${esc(template.id.slice(0, 8))}</strong>
          <label style="display:flex;align-items:center;gap:8px;">
            <input data-field="enabled" type="checkbox" ${template.enabled ? "checked" : ""} />
            <span>${TEXT.enabled}</span>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px;">
          <input data-field="name" class="sheet-input" placeholder="${TEXT.templateName}" value="${esc(template.name)}" />
          <select data-field="zone" class="sheet-input">
            <option value="normal" ${template.zone === "normal" ? "selected" : ""}>${TEXT.normalZone}</option>
            <option value="mid" ${template.zone === "mid" ? "selected" : ""}>${TEXT.midZone}</option>
          </select>
          <input data-field="triggerMonsterSeq" class="sheet-input" type="number" min="1" step="1" placeholder="${TEXT.triggerMonsterSeq}" value="${esc(triggerSeq)}" />
          <input data-field="priority" class="sheet-input" type="number" min="0" step="1" value="${Number(template.priority) || 0}" />
        </div>

        <div style="display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start;">
          <div class="access-card" style="padding:10px;display:grid;gap:8px;">
            <strong>${TEXT.npcSettings}</strong>
            <input data-field="npcName" class="sheet-input" placeholder="${TEXT.npcName}" value="${esc(npc.name || "")}" />
            <div style="height:140px;border:1px solid var(--line-strong);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface);">
              ${npcImage ? `<img src="${esc(npcImage)}" alt="npc" style="max-width:100%;max-height:100%;object-fit:contain;"/>` : `<span class="hint">${TEXT.npcImageMissing}</span>`}
            </div>
            <div style="display:flex;gap:8px;">
              <button class="button npc-upload-image" type="button">${TEXT.uploadImage}</button>
              <button class="button npc-clear-image" type="button">${TEXT.clear}</button>
            </div>
          </div>

          <div style="display:grid;gap:10px;">
            <label>
              <span>${TEXT.openingLine}</span>
              <textarea data-field="startText" class="sheet-input" rows="3" placeholder="${TEXT.openingLinePlaceholder}">${esc(startNode.text || "")}</textarea>
            </label>
            <label>
              <span>${TEXT.durationSec}</span>
              <input data-field="durationSec" class="sheet-input" type="number" min="1" max="600" step="1" value="${Number(template.durationSec) || 12}" />
            </label>
          </div>
        </div>

        <div class="npc-options-wrap" style="display:grid;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${TEXT.optionsAndEffects}</strong>
            <button class="button npc-option-add" type="button">${TEXT.addOption}</button>
          </div>
          <div class="npc-options-list" style="display:grid;gap:8px;">
            ${options.length ? options.map(optionRow).join("") : `<p class="hint" style="margin:0;">${TEXT.noOptions}</p>`}
          </div>
          <details>
            <summary class="hint" style="cursor:pointer;">${TEXT.effectExamples}</summary>
            <pre class="activity-log" style="margin-top:8px;max-height:220px;overflow:auto;">${esc(JSON.stringify(defaultEffectsSample(), null, 2))}</pre>
          </details>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="button monster-event-save" type="button">${TEXT.saveTemplate}</button>
          <button class="button danger monster-event-delete" type="button">${TEXT.deleteTemplate}</button>
        </div>
      </article>
    `;
  }

  function render() {
    if (!templates.length) {
      listEl.innerHTML = `<p class="hint">${TEXT.loadEmpty}</p>`;
      return;
    }
    listEl.innerHTML = templates.map(templateCard).join("");
  }

  async function load() {
    listEl.innerHTML = `<p class="hint">${TEXT.loading}</p>`;
    try {
      templates = await api(`${BASE}?includeDisabled=1`);
      render();
    } catch (error) {
      listEl.innerHTML = `<p class="hint" style="color:var(--danger);">${TEXT.loadFailed}${esc(error.message)}</p>`;
    }
  }

  function readTemplatePayload(cardEl) {
    const id = cardEl.dataset.id;
    const field = (name) => cardEl.querySelector(`[data-field="${name}"]`);
    const rawSeq = String(field("triggerMonsterSeq")?.value || "").trim();

    const optionRows = [...cardEl.querySelectorAll(".npc-option-row")];
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

    const existing = templates.find((template) => template.id === id);
    return {
      enabled: Boolean(field("enabled")?.checked),
      name: String(field("name")?.value || "").trim(),
      zone: field("zone")?.value === "mid" ? "mid" : "normal",
      triggerMonsterSeq: rawSeq ? Number(rawSeq) : null,
      priority: Number(field("priority")?.value || 0),
      durationSec: Number(field("durationSec")?.value || 12),
      message: String(field("startText")?.value || "").trim(),
      npc: {
        name: String(field("npcName")?.value || "").trim() || TEXT.mysteryNpc,
        imageUrl: existing?.npc?.imageUrl || null,
        imageThumbnailUrl: existing?.npc?.imageThumbnailUrl || null
      },
      nodes: [
        {
          id: "start",
          text: String(field("startText")?.value || "").trim(),
          options
        }
      ]
    };
  }

  async function createTemplate() {
    try {
      await api(BASE, {
        method: "POST",
        body: JSON.stringify({
          name: TEXT.createName,
          zone: "normal",
          triggerMonsterSeq: null,
          durationSec: 12,
          priority: 100,
          enabled: true,
          npc: { name: TEXT.mysteryNpc, imageUrl: null, imageThumbnailUrl: null },
          message: TEXT.helloAdventurer,
          nodes: [
            {
              id: "start",
              text: TEXT.helloAdventurer,
              options: [
                { id: "opt_1", label: TEXT.grant100Gold, npcReply: TEXT.yourReward, nextNodeId: null, effects: [{ type: "grant_currency", payload: { currencyType: "gold", amount: 100 } }] }
              ]
            }
          ]
        })
      });
      await load();
      window.logActivity?.(TEXT.createSuccess);
    } catch (error) {
      alert(`${TEXT.createFailed}${error.message}`);
    }
  }

  async function saveTemplate(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    try {
      const payload = readTemplatePayload(cardEl);
      await api(`${BASE}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      window.logActivity?.(`${TEXT.saveSuccess}${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`${TEXT.saveFailed}${error.message}`);
    }
  }

  async function deleteTemplate(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    if (!confirm(TEXT.confirmDelete)) return;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
      window.logActivity?.(`${TEXT.deleteSuccess}${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`${TEXT.deleteFailed}${error.message}`);
    }
  }

  function addOptionRow(cardEl) {
    const list = cardEl.querySelector(".npc-options-list");
    const rows = [...list.querySelectorAll(".npc-option-row")];
    const nextIndex = rows.length;
    const html = optionRow({ label: `${TEXT.option} ${nextIndex + 1}`, npcReply: "", effects: [] }, nextIndex);
    if (!rows.length) list.innerHTML = html;
    else list.insertAdjacentHTML("beforeend", html);
  }

  function uploadNpcImage(cardEl) {
    const id = cardEl.dataset.id;
    if (!id || !npcImgInput) return;
    pendingUploadTemplateId = id;
    npcImgInput.value = "";
    npcImgInput.click();
  }

  async function clearNpcImage(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    const payload = readTemplatePayload(cardEl);
    payload.npc.imageUrl = null;
    payload.npc.imageThumbnailUrl = null;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      await load();
    } catch (error) {
      alert(`${TEXT.clearImageFailed}${error.message}`);
    }
  }

  listEl.addEventListener("click", (event) => {
    const cardEl = event.target.closest(".monster-event-card");
    if (!cardEl) return;

    if (event.target.closest(".monster-event-save")) {
      saveTemplate(cardEl);
      return;
    }
    if (event.target.closest(".monster-event-delete")) {
      deleteTemplate(cardEl);
      return;
    }
    if (event.target.closest(".npc-option-add")) {
      addOptionRow(cardEl);
      return;
    }
    if (event.target.closest(".npc-option-delete")) {
      event.target.closest(".npc-option-row")?.remove();
      return;
    }
    if (event.target.closest(".npc-option-effects")) {
      if (!window.adminEffects) return;
      const rowEl = event.target.closest(".npc-option-row");
      const hidden = rowEl?.querySelector('[data-opt-field="effectsData"]');
      window.adminEffects.ensureLookups().then(() => {
        const effects = window.adminEffects.decodeState(hidden?.value, []);
        window.adminEffects.openNpcOptionEditor(effects, (nextEffects) => {
          if (hidden) hidden.value = window.adminEffects.encodeState(nextEffects);
          const summary = rowEl?.querySelector(".npc-option-effects-summary");
          if (summary) summary.textContent = window.adminEffects.summarizeNpcEffects(nextEffects);
        });
      }).catch((error) => alert(error.message || String(error)));
      return;
    }
    if (event.target.closest(".npc-upload-image")) {
      uploadNpcImage(cardEl);
      return;
    }
    if (event.target.closest(".npc-clear-image")) {
      clearNpcImage(cardEl);
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
      await load();
      window.logActivity?.(`${TEXT.uploadSuccess}${id.slice(0, 8)}`);
    } catch (error) {
      alert(`${TEXT.uploadFailed}${error.message}`);
    } finally {
      pendingUploadTemplateId = null;
      npcImgInput.value = "";
    }
  });

  refreshBtn?.addEventListener("click", load);
  addBtn?.addEventListener("click", createTemplate);

  window.addEventListener("load", () => {
    if (window.getAdminToken?.()) load();
  });
})();
