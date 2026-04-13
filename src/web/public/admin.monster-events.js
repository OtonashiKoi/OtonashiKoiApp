(function () {
  const BASE = "/admin/monster-events";
  const listEl = document.getElementById("monster-events-list");
  const refreshBtn = document.getElementById("monster-events-refresh-btn");
  const addBtn = document.getElementById("monster-events-add-btn");
  const npcImgInput = document.getElementById("monster-events-npc-img-input");
  if (!listEl) return;

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
    const effectsJson = JSON.stringify(Array.isArray(option.effects) ? option.effects : [], null, 2);
    return `
      <div class="npc-option-row" data-option-index="${index}" style="border:1px dashed var(--line-strong);border-radius:8px;padding:10px;display:grid;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>選項 ${index + 1}</strong>
          <button class="button danger npc-option-delete" type="button">刪除選項</button>
        </div>
        <input class="sheet-input" data-opt-field="label" placeholder="玩家看到的選項文字" value="${esc(option.label || "")}" />
        <textarea class="sheet-input" data-opt-field="npcReply" rows="2" placeholder="玩家選這個選項後，NPC 要說的話">${esc(option.npcReply || "")}</textarea>
        <label>
          <span class="hint">效果列表 (JSON Array)</span>
          <textarea class="sheet-input" data-opt-field="effects" rows="5" style="font-family:ui-monospace,Consolas,monospace;">${esc(effectsJson)}</textarea>
        </label>
      </div>
    `;
  }

  function templateCard(template) {
    const triggerSeq = template.triggerMonsterSeq == null ? "" : template.triggerMonsterSeq;
    const npc = template.npc || { name: "神秘 NPC", imageUrl: null, imageThumbnailUrl: null };
    const startNode = getStartNode(template);
    const options = Array.isArray(startNode.options) ? startNode.options : [];
    const npcImage = npc.imageThumbnailUrl || npc.imageUrl || "";

    return `
      <article class="access-card monster-event-card" data-id="${esc(template.id)}" style="display:grid;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <strong>模板 #${esc(template.id.slice(0, 8))}</strong>
          <label style="display:flex;align-items:center;gap:8px;">
            <input data-field="enabled" type="checkbox" ${template.enabled ? "checked" : ""} />
            <span>啟用</span>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px;">
          <input data-field="name" class="sheet-input" placeholder="模板名稱" value="${esc(template.name)}" />
          <select data-field="zone" class="sheet-input">
            <option value="normal" ${template.zone === "normal" ? "selected" : ""}>一般區</option>
            <option value="mid" ${template.zone === "mid" ? "selected" : ""}>中級區</option>
          </select>
          <input data-field="triggerMonsterSeq" class="sheet-input" type="number" min="1" step="1" placeholder="觸發怪序" value="${esc(triggerSeq)}" />
          <input data-field="priority" class="sheet-input" type="number" min="0" step="1" value="${Number(template.priority) || 0}" />
        </div>

        <div style="display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start;">
          <div class="access-card" style="padding:10px;display:grid;gap:8px;">
            <strong>NPC 設定</strong>
            <input data-field="npcName" class="sheet-input" placeholder="NPC 名稱" value="${esc(npc.name || "")}" />
            <div style="height:140px;border:1px solid var(--line-strong);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface);">
              ${npcImage ? `<img src="${esc(npcImage)}" alt="npc" style="max-width:100%;max-height:100%;object-fit:contain;"/>` : `<span class="hint">尚未設定圖片</span>`}
            </div>
            <div style="display:flex;gap:8px;">
              <button class="button npc-upload-image" type="button">上傳圖片</button>
              <button class="button npc-clear-image" type="button">清除</button>
            </div>
          </div>

          <div style="display:grid;gap:10px;">
            <label>
              <span>開場台詞</span>
              <textarea data-field="startText" class="sheet-input" rows="3" placeholder="NPC 出現後先說的話">${esc(startNode.text || "")}</textarea>
            </label>
            <label>
              <span>事件保留秒數（供怪物切換等待）</span>
              <input data-field="durationSec" class="sheet-input" type="number" min="1" max="600" step="1" value="${Number(template.durationSec) || 12}" />
            </label>
          </div>
        </div>

        <div class="npc-options-wrap" style="display:grid;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>選項與效果</strong>
            <button class="button npc-option-add" type="button">＋ 新增選項</button>
          </div>
          <div class="npc-options-list" style="display:grid;gap:8px;">
            ${options.length ? options.map(optionRow).join("") : `<p class="hint" style="margin:0;">尚無選項，請新增。</p>`}
          </div>
          <details>
            <summary class="hint" style="cursor:pointer;">效果範例（點開可複製）</summary>
            <pre class="activity-log" style="margin-top:8px;max-height:220px;overflow:auto;">${esc(JSON.stringify(defaultEffectsSample(), null, 2))}</pre>
          </details>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="button monster-event-save" type="button">儲存模板</button>
          <button class="button danger monster-event-delete" type="button">刪除模板</button>
        </div>
      </article>
    `;
  }

  function render() {
    if (!templates.length) {
      listEl.innerHTML = `<p class="hint">目前沒有 NPC 模板，點「新增模板」建立第一個。</p>`;
      return;
    }
    listEl.innerHTML = templates.map(templateCard).join("");
  }

  async function load() {
    listEl.innerHTML = `<p class="hint">載入中...</p>`;
    try {
      templates = await api(`${BASE}?includeDisabled=1`);
      render();
    } catch (error) {
      listEl.innerHTML = `<p class="hint" style="color:var(--danger);">載入失敗：${esc(error.message)}</p>`;
    }
  }

  function parseEffects(jsonText) {
    if (!jsonText || !String(jsonText).trim()) return [];
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) throw new Error("effects must be a JSON array");
    return parsed;
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
        label: String(get("label")?.value || "").trim() || `選項 ${idx + 1}`,
        npcReply: String(get("npcReply")?.value || "").trim(),
        nextNodeId: null,
        effects: parseEffects(get("effects")?.value || "[]")
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
        name: String(field("npcName")?.value || "").trim() || "神秘 NPC",
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
          name: "新 NPC 模板",
          zone: "normal",
          triggerMonsterSeq: null,
          durationSec: 12,
          priority: 100,
          enabled: true,
          npc: { name: "神秘 NPC", imageUrl: null, imageThumbnailUrl: null },
          message: "你好，冒險者。",
          nodes: [
            {
              id: "start",
              text: "你好，冒險者。",
              options: [
                { id: "opt_1", label: "領取 100 金幣", npcReply: "這是你的獎勵。", nextNodeId: null, effects: [{ type: "grant_currency", payload: { currencyType: "gold", amount: 100 } }] }
              ]
            }
          ]
        })
      });
      await load();
      window.logActivity?.("已新增 NPC 事件模板");
    } catch (error) {
      alert(`新增失敗：${error.message}`);
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
      window.logActivity?.(`已儲存 NPC 模板 ${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`儲存失敗：${error.message}`);
    }
  }

  async function deleteTemplate(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    if (!confirm("確定要刪除此 NPC 模板？")) return;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
      window.logActivity?.(`已刪除 NPC 模板 ${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`刪除失敗：${error.message}`);
    }
  }

  function addOptionRow(cardEl) {
    const list = cardEl.querySelector(".npc-options-list");
    const rows = [...list.querySelectorAll(".npc-option-row")];
    const nextIndex = rows.length;
    const html = optionRow({ label: `選項 ${nextIndex + 1}`, npcReply: "", effects: [] }, nextIndex);
    if (!rows.length) list.innerHTML = html;
    else list.insertAdjacentHTML("beforeend", html);
  }

  async function uploadNpcImage(cardEl) {
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
      alert(`清除圖片失敗：${error.message}`);
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
      window.logActivity?.(`已更新 NPC 圖片 ${id.slice(0, 8)}`);
    } catch (error) {
      alert(`上傳失敗：${error.message}`);
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
