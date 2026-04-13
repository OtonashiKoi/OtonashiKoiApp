(function () {
  const BASE = "/admin/monster-events";
  const listEl = document.getElementById("monster-events-list");
  const refreshBtn = document.getElementById("monster-events-refresh-btn");
  const addBtn = document.getElementById("monster-events-add-btn");
  if (!listEl) return;

  let events = [];

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

  function card(event) {
    const triggerSeq = event.triggerMonsterSeq == null ? "" : event.triggerMonsterSeq;
    return `
      <article class="access-card monster-event-card" data-id="${esc(event.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
          <strong>事件 #${esc(event.id.slice(0, 8))}</strong>
          <label style="display:flex;align-items:center;gap:6px;">
            <input data-field="enabled" type="checkbox" ${event.enabled ? "checked" : ""} />
            <span>啟用</span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1.6fr 0.7fr 0.7fr 0.7fr;gap:10px;margin-bottom:10px;">
          <input data-field="name" class="sheet-input" value="${esc(event.name)}" placeholder="事件名稱" />
          <select data-field="zone" class="sheet-input">
            <option value="normal" ${event.zone === "normal" ? "selected" : ""}>一般區</option>
            <option value="mid" ${event.zone === "mid" ? "selected" : ""}>中級區</option>
          </select>
          <input data-field="triggerMonsterSeq" class="sheet-input" type="number" min="1" step="1" value="${esc(triggerSeq)}" placeholder="怪序號(留空=任意)" />
          <input data-field="priority" class="sheet-input" type="number" min="0" step="1" value="${Number(event.priority) || 0}" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 3fr;gap:10px;align-items:start;">
          <input data-field="durationSec" class="sheet-input" type="number" min="3" max="300" step="1" value="${Number(event.durationSec) || 12}" />
          <textarea data-field="message" class="sheet-input" rows="2" placeholder="事件訊息">${esc(event.message)}</textarea>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <span class="hint">優先序越小越先觸發；怪序號留空表示該區任意怪都可觸發。</span>
          <div style="display:flex;gap:8px;">
            <button class="button monster-event-save" type="button">儲存</button>
            <button class="button danger monster-event-delete" type="button">刪除</button>
          </div>
        </div>
      </article>
    `;
  }

  function render() {
    if (!events.length) {
      listEl.innerHTML = `<p class="hint">目前沒有事件，點「新增事件」建立第一筆。</p>`;
      return;
    }
    listEl.innerHTML = events.map(card).join("");
  }

  async function load() {
    listEl.innerHTML = `<p class="hint">載入中...</p>`;
    try {
      events = await api(`${BASE}?includeDisabled=1`);
      render();
    } catch (error) {
      listEl.innerHTML = `<p class="hint" style="color:var(--danger);">讀取失敗：${esc(error.message)}</p>`;
    }
  }

  function readCardPayload(cardEl) {
    const field = (name) => cardEl.querySelector(`[data-field="${name}"]`);
    const rawSeq = String(field("triggerMonsterSeq")?.value || "").trim();
    return {
      enabled: Boolean(field("enabled")?.checked),
      name: String(field("name")?.value || "").trim(),
      zone: field("zone")?.value === "mid" ? "mid" : "normal",
      triggerMonsterSeq: rawSeq ? Number(rawSeq) : null,
      priority: Number(field("priority")?.value || 0),
      durationSec: Number(field("durationSec")?.value || 12),
      message: String(field("message")?.value || "").trim()
    };
  }

  async function createEvent() {
    try {
      await api(BASE, {
        method: "POST",
        body: JSON.stringify({
          name: "新事件",
          message: "事件進行中，請稍候...",
          zone: "normal",
          durationSec: 12,
          priority: 100,
          triggerMonsterSeq: null,
          enabled: true
        })
      });
      await load();
      window.logActivity?.("已新增怪物切換事件");
    } catch (error) {
      alert(`新增失敗：${error.message}`);
    }
  }

  async function saveEvent(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(readCardPayload(cardEl))
      });
      window.logActivity?.(`已更新怪物事件 ${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`儲存失敗：${error.message}`);
    }
  }

  async function deleteEvent(cardEl) {
    const id = cardEl.dataset.id;
    if (!id) return;
    if (!confirm("確定要刪除此事件？")) return;
    try {
      await api(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
      window.logActivity?.(`已刪除怪物事件 ${id.slice(0, 8)}`);
      await load();
    } catch (error) {
      alert(`刪除失敗：${error.message}`);
    }
  }

  listEl.addEventListener("click", (event) => {
    const cardEl = event.target.closest(".monster-event-card");
    if (!cardEl) return;
    if (event.target.closest(".monster-event-save")) {
      saveEvent(cardEl);
      return;
    }
    if (event.target.closest(".monster-event-delete")) {
      deleteEvent(cardEl);
    }
  });

  refreshBtn?.addEventListener("click", load);
  addBtn?.addEventListener("click", createEvent);

  window.addEventListener("load", () => {
    if (window.getAdminToken?.()) load();
  });
})();
