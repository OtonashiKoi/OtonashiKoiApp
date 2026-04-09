/* admin.weekly.js — 每週任務管理 */
(function () {
  const QUEST_TYPE_LABELS = {
    battle_count:  "出戰次數",
    battle_win:    "戰鬥勝利次數",
    damage_total:  "累計造成傷害",
    checkin_count: "打卡次數",
  };
  const QUEST_TYPE_UNITS = {
    battle_count:  "次",
    battle_win:    "次",
    damage_total:  "點",
    checkin_count: "次",
  };

  let quests = [];
  let itemLib = [];

  const listEl    = document.getElementById("weekly-quest-list");
  const addBtn    = document.getElementById("weekly-add-btn");
  const summaryEl = document.getElementById("weekly-summary-area");
  const summaryBtn = document.getElementById("weekly-summary-btn");

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (window.getAdminToken ? window.getAdminToken() : ""),
    };
  }

  // ── 載入 ─────────────────────────────────────────────

  async function loadItems() {
    try {
      const res = await fetch("/admin/items", { headers: apiHeaders() });
      const json = await res.json();
      if (json.status === "ok") itemLib = json.data || [];
    } catch (_) {}
  }

  async function loadQuests() {
    if (!listEl) return;
    listEl.innerHTML = `<p class="hint">載入中…</p>`;
    try {
      const res = await fetch("/admin/weekly-quests", { headers: apiHeaders() });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "載入失敗");
      quests = json.data || [];
      renderList();
    } catch (e) {
      listEl.innerHTML = `<p class="hint" style="color:var(--error,#f87171);">❌ ${escHtml(e.message)}</p>`;
    }
  }

  // ── 渲染任務列表 ────────────────────────────────────

  function renderList() {
    if (!listEl) return;
    if (!quests.length) {
      listEl.innerHTML = `<p class="hint">尚無任務，點「➕ 新增任務」開始建立。</p>`;
      return;
    }
    listEl.innerHTML = "";
    quests.forEach((q) => listEl.appendChild(buildCard(q)));
  }

  function buildItemOption(selectedId) {
    const none = `<option value="">-- 無獎勵道具 --</option>`;
    const opts = itemLib.map((i) =>
      `<option value="${escAttr(i.id)}" ${i.id === selectedId ? "selected" : ""}>${escHtml(i.name)}</option>`
    ).join("");
    return none + opts;
  }

  function buildCard(q) {
    const div = document.createElement("div");
    div.className = "access-card";
    div.dataset.questId = q.id;
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;">${escHtml(q.title)}</h3>
        <div style="display:flex;gap:8px;">
          <button class="wq-save-btn button" style="padding:4px 12px;font-size:0.82em;">💾 儲存</button>
          <button class="wq-del-btn button" style="padding:4px 12px;font-size:0.82em;background:var(--error,#b91c1c);">🗑️ 刪除</button>
        </div>
      </div>
      <div class="grid two-up" style="gap:10px;">
        <label>
          <span>任務名稱</span>
          <input class="sheet-input" data-field="title" type="text" value="${escAttr(q.title)}" />
        </label>
        <label>
          <span>任務類型</span>
          <select class="sheet-input" data-field="type">
            ${Object.entries(QUEST_TYPE_LABELS).map(([k, v]) =>
              `<option value="${k}" ${q.type === k ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
        </label>
        <label>
          <span>目標數量（${QUEST_TYPE_UNITS[q.type] || "次"}）</span>
          <input class="sheet-input" data-field="target" type="number" min="1" value="${q.target}" />
        </label>
        <label>
          <span>啟用</span>
          <select class="sheet-input" data-field="enabled">
            <option value="true"  ${q.enabled ? "selected" : ""}>✅ 啟用</option>
            <option value="false" ${!q.enabled ? "selected" : ""}>❌ 停用</option>
          </select>
        </label>
        <label>
          <span>獎勵金幣 🪙</span>
          <input class="sheet-input" data-field="rewardGold" type="number" min="0" value="${q.rewardGold}" />
        </label>
        <label>
          <span>獎勵鑽石 💎</span>
          <input class="sheet-input" data-field="rewardDiamond" type="number" min="0" value="${q.rewardDiamond}" />
        </label>
        <label style="grid-column:1/-1;">
          <span>獎勵道具（選填）</span>
          <select class="sheet-input" data-field="rewardItemId">
            ${buildItemOption(q.rewardItemId)}
          </select>
        </label>
        <label style="grid-column:1/-1;">
          <span>任務說明（選填）</span>
          <input class="sheet-input" data-field="description" type="text" value="${escAttr(q.description || "")}" />
        </label>
      </div>
    `;

    // Update unit label when type changes
    const typeSelect = div.querySelector("[data-field=type]");
    const targetLabel = div.querySelector("[data-field=target]").previousElementSibling;
    typeSelect.addEventListener("change", () => {
      targetLabel.textContent = `目標數量（${QUEST_TYPE_UNITS[typeSelect.value] || "次"}）`;
    });

    div.querySelector(".wq-save-btn").addEventListener("click", () => saveQuest(div, q.id));
    div.querySelector(".wq-del-btn").addEventListener("click", () => deleteQuest(q.id, div));

    return div;
  }

  function getPayload(div) {
    return {
      title:         div.querySelector("[data-field=title]")?.value.trim(),
      type:          div.querySelector("[data-field=type]")?.value,
      target:        Number(div.querySelector("[data-field=target]")?.value),
      enabled:       div.querySelector("[data-field=enabled]")?.value === "true",
      rewardGold:    Number(div.querySelector("[data-field=rewardGold]")?.value),
      rewardDiamond: Number(div.querySelector("[data-field=rewardDiamond]")?.value),
      rewardItemId:  div.querySelector("[data-field=rewardItemId]")?.value || null,
      description:   div.querySelector("[data-field=description]")?.value.trim(),
    };
  }

  // ── CRUD 操作 ──────────────────────────────────────

  async function saveQuest(div, id) {
    const btn = div.querySelector(".wq-save-btn");
    if (btn._saving) return;
    btn._saving = true;
    const orig = btn.textContent;
    btn.textContent = "儲存中…";
    try {
      const payload = getPayload(div);
      const res = await fetch(`/admin/weekly-quests/${id}`, {
        method: "PUT", headers: apiHeaders(), body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "儲存失敗");
      const idx = quests.findIndex((q) => q.id === id);
      if (idx >= 0) quests[idx] = json.data;
      btn.textContent = "✅ 已儲存";
      setTimeout(() => { btn.textContent = orig; btn._saving = false; }, 1500);
    } catch (e) {
      alert("❌ " + e.message);
      btn.textContent = orig;
      btn._saving = false;
    }
  }

  async function deleteQuest(id, div) {
    if (!confirm("確定刪除此任務？")) return;
    try {
      const res = await fetch(`/admin/weekly-quests/${id}`, {
        method: "DELETE", headers: apiHeaders(),
      });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "刪除失敗");
      quests = quests.filter((q) => q.id !== id);
      div.remove();
      if (!quests.length) listEl.innerHTML = `<p class="hint">尚無任務，點「➕ 新增任務」開始建立。</p>`;
    } catch (e) {
      alert("❌ " + e.message);
    }
  }

  async function addNewQuest() {
    try {
      const payload = {
        title: "新任務",
        type: "battle_count",
        target: 10,
        rewardGold: 100,
        rewardDiamond: 0,
        enabled: true,
      };
      const res = await fetch("/admin/weekly-quests", {
        method: "POST", headers: apiHeaders(), body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "新增失敗");
      quests.push(json.data);
      if (listEl.querySelector(".hint")) listEl.innerHTML = "";
      listEl.appendChild(buildCard(json.data));
    } catch (e) {
      alert("❌ " + e.message);
    }
  }

  // ── 本週概況 ────────────────────────────────────────

  async function loadSummary() {
    if (!summaryEl) return;
    summaryEl.innerHTML = `<p class="hint">載入中…</p>`;
    try {
      const res = await fetch("/admin/weekly-quests/summary", { headers: apiHeaders() });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "載入失敗");
      const { weekLabel, quests: qs, progress } = json.data;
      if (!qs.length) {
        summaryEl.innerHTML = `<p class="hint">本週（${weekLabel}）尚無任務定義。</p>`;
        return;
      }
      const playerIds = Object.keys(progress);
      if (!playerIds.length) {
        summaryEl.innerHTML = `<p class="hint">本週（${weekLabel}）尚無玩家進度資料。</p>`;
        return;
      }
      let html = `<p style="font-size:0.85em;color:var(--muted);margin-bottom:8px;">週次：${weekLabel}</p>`;
      html += `<div style="overflow-x:auto;"><table class="admin-table" style="min-width:400px;"><thead><tr>`;
      html += `<th>玩家</th>`;
      qs.forEach((q) => { html += `<th>${escHtml(q.title)}</th>`; });
      html += `</tr></thead><tbody>`;
      playerIds.forEach((pid) => {
        const pData = progress[pid] || {};
        html += `<tr><td style="font-size:0.82em;">${escHtml(pid.slice(-6))}</td>`;
        qs.forEach((q) => {
          const p = pData[q.id] || { current: 0, claimed: false, done: false };
          const icon = p.claimed ? "✅" : p.done ? "🔔" : "🔲";
          html += `<td style="text-align:center;">${icon} ${p.current}/${q.target}</td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody></table></div>`;
      html += `<p style="font-size:0.78em;color:var(--muted);margin-top:6px;">✅已領取 🔔已完成未領 🔲進行中</p>`;
      summaryEl.innerHTML = html;
    } catch (e) {
      summaryEl.innerHTML = `<p class="hint" style="color:var(--error,#f87171);">❌ ${escHtml(e.message)}</p>`;
    }
  }

  // ── 初始化 ──────────────────────────────────────────

  function escHtml(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function escAttr(s) { return escHtml(s); }

  addBtn && addBtn.addEventListener("click", addNewQuest);
  summaryBtn && summaryBtn.addEventListener("click", loadSummary);

  // 後台已登入後才加載（監聽 adminConnected 事件）
  document.addEventListener("adminConnected", async () => {
    await loadItems();
    await loadQuests();
  });

  // 也允許直接呼叫（若頁面已就緒）
  window.loadWeeklyQuests = loadQuests;
})();
