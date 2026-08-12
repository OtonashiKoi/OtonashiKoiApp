/* admin.weekly.js — 每週任務管理 */
(function () {
  const QUEST_TYPE_LABELS = {
    battle_count:  "出戰次數",
    battle_with_sword: "使用劍系出戰次數",
    battle_with_axe: "使用斧系出戰次數",
    battle_with_mace: "使用槌系出戰次數",
    battle_with_dagger: "使用匕首出戰次數",
    battle_with_staff: "使用法杖出戰次數",
    battle_with_bow: "使用弓出戰次數",
    battle_with_dice: "使用骰子出戰次數",
    // ⛔ battle_as_*（350 場計數式二轉試煉）已於 2026-08-09 移除：服務端從來沒有對應的計數邏輯，
    //    建了也永遠打不完；且不走 transferJob → 不檢查徽章練滿、不消耗一轉、不扣費、繞過賽季閘門。
    //    二轉唯一路徑＝ t2_transfer。
    battle_win:    "戰鬥勝利次數",
    damage_total:  "累計造成傷害",
    level_10_job_badge: "達成 Lv.10 並獲得職業徽章",
    checkin_count: "打卡次數",
    stream_bind_count: "直播綁定次數",
    equip_count: "裝備次數",
    enhance_count: "強化次數",
    combo_count: "成功連擊次數",
    dodge_count: "成功迴避次數",
    block_count: "成功格擋次數",
    stun_count: "成功擊暈次數",
    death_count: "角色死亡次數",
    burn_trigger_count: "成功觸發燃燒次數",
    onboarding_complete_count: "完成全部新手任務",
    weekly_complete_count: "完成全部每週任務",
    kill_slime_king: "擊敗大史王 次數",
    kill_dragon_king: "擊敗古龍王(B) 次數",
    kill_hellfang_king: "擊敗地獄狼牙王 次數",
    kill_island_turtle: "擊敗島島龜王 次數",
    enhance_a5_count: "A 裝強化至 +5 累積",
  };
  const QUEST_TYPE_UNITS = {
    battle_count:  "次",
    battle_with_sword: "次",
    battle_with_axe: "次",
    battle_with_mace: "次",
    battle_with_dagger: "次",
    battle_with_staff: "次",
    battle_with_bow: "次",
    battle_with_dice: "次",
    battle_win:    "次",
    damage_total:  "點",
    level_10_job_badge: "項",
    checkin_count: "次",
    stream_bind_count: "次",
    equip_count: "次",
    enhance_count: "次",
    combo_count: "次",
    dodge_count: "次",
    block_count: "次",
    stun_count: "次",
    death_count: "次",
    burn_trigger_count: "次",
    onboarding_complete_count: "項",
    weekly_complete_count: "項",
    kill_slime_king: "次",
    kill_dragon_king: "次",
    kill_hellfang_king: "次",
    kill_island_turtle: "次",
    enhance_a5_count: "件",
  };
  const CADENCE_LABELS = {
    onboarding: "新手",
    job: "職業",
    daily: "每日",
    weekly: "每週",
    season: "賽季成就"
  };

  let quests = [];
  let itemLib = [];
  const filters = {
    search: "",
    cadence: "all",
    type: "all",
    enabled: "all"
  };

  const listEl    = document.getElementById("weekly-quest-list");
  const addBtn    = document.getElementById("weekly-add-btn");
  const seedBtn   = document.getElementById("weekly-seed-btn");
  const summaryEl = document.getElementById("weekly-summary-area");
  const summaryBtn = document.getElementById("weekly-summary-btn");
  const filterSearchEl = document.getElementById("weekly-filter-search");
  const filterCadenceEl = document.getElementById("weekly-filter-cadence");
  const filterTypeEl = document.getElementById("weekly-filter-type");
  const filterEnabledEl = document.getElementById("weekly-filter-enabled");
  const filterResetEl = document.getElementById("weekly-filter-reset");
  const filterStatsEl = document.getElementById("weekly-filter-stats");

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
      // 新路由（統一任務管理）
      const resNew = await fetch("/admin/quests", { headers: apiHeaders() });
      const jsonNew = await resNew.json().catch(() => null);
      if (jsonNew && jsonNew.status === "ok") {
        quests = jsonNew.data || [];
        renderTypeFilterOptions();
        renderList();
        return;
      }
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "載入失敗");
      quests = json.data || [];
      renderTypeFilterOptions();
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
      if (filterStatsEl) filterStatsEl.textContent = "目前 0 / 0 筆";
      return;
    }
    const rows = getFilteredQuests();
    if (!rows.length) {
      listEl.innerHTML = `<p class="hint">目前篩選條件下沒有任務，請調整篩選。</p>`;
      if (filterStatsEl) filterStatsEl.textContent = `目前 0 / ${quests.length} 筆`;
      return;
    }
    listEl.innerHTML = "";
    rows.forEach((q) => listEl.appendChild(buildCard(q)));
    if (filterStatsEl) filterStatsEl.textContent = `目前 ${rows.length} / ${quests.length} 筆`;
  }

  function getFilteredQuests() {
    const normalize = (v) => String(v || "").trim().toLowerCase();
    const search = normalize(filters.search);
    return [...quests]
      .sort((a, b) => {
        const cadenceRank = { onboarding: 1, job: 2, daily: 3, weekly: 4, season: 5 };
        const ar = cadenceRank[a.cadence || "weekly"] || 99;
        const br = cadenceRank[b.cadence || "weekly"] || 99;
        if (ar !== br) return ar - br;
        const aso = Number(a.sortOrder || 0);
        const bso = Number(b.sortOrder || 0);
        if (aso !== bso) return aso - bso;
        return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hant");
      })
      .filter((q) => {
        if (filters.cadence !== "all" && (q.cadence || "weekly") !== filters.cadence) return false;
        if (filters.type !== "all" && q.type !== filters.type) return false;
        if (filters.enabled !== "all" && String(Boolean(q.enabled)) !== filters.enabled) return false;
        if (search) {
          const hay = `${q.title || ""} ${q.description || ""} ${QUEST_TYPE_LABELS[q.type] || q.type || ""}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });
  }

  function renderTypeFilterOptions() {
    if (!filterTypeEl) return;
    const current = filterTypeEl.value || "all";
    const existingTypes = [...new Set((quests || []).map((q) => q.type).filter(Boolean))];
    const base = `<option value="all">全部</option>`;
    const opts = existingTypes
      .map((type) => `<option value="${escAttr(type)}">${escHtml(QUEST_TYPE_LABELS[type] || type)}</option>`)
      .join("");
    filterTypeEl.innerHTML = base + opts;
    filterTypeEl.value = existingTypes.includes(current) ? current : "all";
    filters.type = filterTypeEl.value;
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
    div.className = `access-card quest-card ${q.enabled ? "" : "is-disabled"}`.trim();
    div.dataset.questId = q.id;
    div.innerHTML = `
      <div class="quest-card-head">
        <div style="flex:1;min-width:0;">
          <h3 style="margin:0 0 6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(q.title)}</h3>
          <div class="quest-card-meta">
            <span class="quest-chip cadence-${escAttr(q.cadence || "weekly")}">${escHtml(CADENCE_LABELS[q.cadence] || "每週")}</span>
            <span class="quest-chip">${escHtml(QUEST_TYPE_LABELS[q.type] || q.type)}</span>
            <span class="quest-chip enabled-${String(Boolean(q.enabled))}">${q.enabled ? "啟用中" : "停用中"}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="wq-save-btn button" style="padding:4px 12px;font-size:0.82em;">💾 儲存</button>
          <button class="wq-del-btn button" style="padding:4px 12px;font-size:0.82em;background:var(--error,#b91c1c);">🗑️ 刪除</button>
        </div>
      </div>
      <div class="quest-form-grid">
        <label>
          <span>任務名稱</span>
          <input class="sheet-input" data-field="title" type="text" value="${escAttr(q.title)}" />
        </label>
        <label>
          <span>任務週期</span>
          <select class="sheet-input" data-field="cadence">
            ${Object.entries(CADENCE_LABELS).map(([k, v]) =>
              `<option value="${k}" ${(q.cadence || "weekly") === k ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
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
          <span>等級限制（達到此等級才可見；0 表示不限制）</span>
          <input class="sheet-input" data-field="levelLimit" type="number" min="0" value="${q.levelLimit || 0}" />
        </label>
        <label>
          <span>重置規則</span>
          <input class="sheet-input" data-field="resetPolicy" type="text" value="${escAttr(q.resetPolicy || "")}" placeholder="once / tw_daily / tw_weekly" />
        </label>
        <label>
          <span>排序（小到大）</span>
          <input class="sheet-input" data-field="sortOrder" type="number" min="0" value="${Number(q.sortOrder || 0)}" />
        </label>
        <label>
          <span>獎勵金幣 🪙</span>
          <input class="sheet-input" data-field="rewardGold" type="number" min="0" value="${q.rewardGold}" />
        </label>
        <label>
          <span>獎勵 EXP ⭐</span>
          <input class="sheet-input" data-field="rewardExp" type="number" min="0" value="${Number(q.rewardExp || 0)}" />
        </label>
        <label style="grid-column:1/-1;">
          <span>獎勵道具（選填）</span>
          <select class="sheet-input" data-field="rewardItemId">
            ${buildItemOption(q.rewardItemId)}
          </select>
        </label>
        <label class="span-full">
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
      cadence:       div.querySelector("[data-field=cadence]")?.value || "weekly",
      type:          div.querySelector("[data-field=type]")?.value,
      target:        Number(div.querySelector("[data-field=target]")?.value),
      enabled:       div.querySelector("[data-field=enabled]")?.value === "true",
      levelLimit:    Number(div.querySelector("[data-field=levelLimit]")?.value) || 0,
      resetPolicy:   div.querySelector("[data-field=resetPolicy]")?.value.trim() || null,
      sortOrder:     Number(div.querySelector("[data-field=sortOrder]")?.value) || 0,
      rewardGold:    Number(div.querySelector("[data-field=rewardGold]")?.value),
      rewardExp:     Number(div.querySelector("[data-field=rewardExp]")?.value),
      rewardDiamond: 0,
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
      const res = await fetch(`/admin/quests/${id}`, {
        method: "PUT", headers: apiHeaders(), body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "儲存失敗");
      const idx = quests.findIndex((q) => q.id === id);
      if (idx >= 0) quests[idx] = json.data;
      renderTypeFilterOptions();
      renderList();
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
      const res = await fetch(`/admin/quests/${id}`, {
        method: "DELETE", headers: apiHeaders(),
      });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "刪除失敗");
      quests = quests.filter((q) => q.id !== id);
      renderTypeFilterOptions();
      renderList();
    } catch (e) {
      alert("❌ " + e.message);
    }
  }

  async function addNewQuest() {
    try {
      const payload = {
        title: "新任務",
        cadence: "weekly",
        type: "battle_count",
        target: 10,
        rewardGold: 100,
        rewardExp: 60,
        rewardDiamond: 0,
        enabled: true,
        levelLimit: 0,
        resetPolicy: "tw_weekly",
      };
      const res = await fetch("/admin/quests", {
        method: "POST", headers: apiHeaders(), body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "新增失敗");
      quests.push(json.data);
      renderTypeFilterOptions();
      renderList();
    } catch (e) {
      alert("❌ " + e.message);
    }
  }

  async function seedDefaultQuests() {
    if (!confirm("補齊預設新手/職業/每日/每週任務？（不會覆蓋現有任務）")) return;
    if (seedBtn) {
      seedBtn.disabled = true;
      seedBtn.textContent = "補齊中…";
    }
    try {
      const res = await fetch("/admin/quests/seed", { method: "POST", headers: apiHeaders() });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "補齊失敗");
      const createdCount = json?.data?.createdCount ?? 0;
      alert(`✅ 已補齊預設任務，新增 ${createdCount} 筆`);
      await loadQuests();
    } catch (e) {
      alert(`❌ ${e.message}`);
    } finally {
      if (seedBtn) {
        seedBtn.disabled = false;
        seedBtn.textContent = "🌱 補齊預設任務";
      }
    }
  }

  // ── 本週概況 ────────────────────────────────────────

  async function loadSummary() {
    if (!summaryEl) return;
    summaryEl.innerHTML = `<p class="hint">載入中…</p>`;
    try {
      const res = await fetch("/admin/quests/summary?cadence=weekly", { headers: apiHeaders() });
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "載入失敗");
      const weekLabel = json.data.weekLabel || json.data.periodKey || "";
      const qs = json.data.quests || [];
      const progress = json.data.progress || {};
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
  seedBtn && seedBtn.addEventListener("click", seedDefaultQuests);
  summaryBtn && summaryBtn.addEventListener("click", loadSummary);
  filterSearchEl && filterSearchEl.addEventListener("input", () => {
    filters.search = filterSearchEl.value || "";
    renderList();
  });
  filterCadenceEl && filterCadenceEl.addEventListener("change", () => {
    filters.cadence = filterCadenceEl.value || "all";
    renderList();
  });
  filterTypeEl && filterTypeEl.addEventListener("change", () => {
    filters.type = filterTypeEl.value || "all";
    renderList();
  });
  filterEnabledEl && filterEnabledEl.addEventListener("change", () => {
    filters.enabled = filterEnabledEl.value || "all";
    renderList();
  });
  filterResetEl && filterResetEl.addEventListener("click", () => {
    filters.search = "";
    filters.cadence = "all";
    filters.type = "all";
    filters.enabled = "all";
    if (filterSearchEl) filterSearchEl.value = "";
    if (filterCadenceEl) filterCadenceEl.value = "all";
    if (filterTypeEl) filterTypeEl.value = "all";
    if (filterEnabledEl) filterEnabledEl.value = "all";
    renderList();
  });

  // 後台已登入後才加載（監聽 adminConnected 事件）
  document.addEventListener("adminConnected", async () => {
    await loadItems();
    await loadQuests();
    renderTypeFilterOptions();
    renderList();
  });

  // 也允許直接呼叫（若頁面已就緒）
  window.loadWeeklyQuests = loadQuests;
})();
