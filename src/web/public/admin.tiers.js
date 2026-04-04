/* admin.tiers.js — 玩家等級設定（E~SS） */
(function () {
  const RANKS = ["E", "D", "C", "B", "A", "S", "SS"];

  // 在 admin.tiers.js 外部暴露 tierData，讓 admin.shop.js 可以讀取
  window.playerTiers = {};

  const formArea = document.getElementById("tiers-form-area");
  const saveBtn  = document.getElementById("tiers-save-btn");

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}`
    };
  }

  async function loadTiers() {
    const res = await fetch("/admin/player-tiers", { headers: apiHeaders() });
    const json = await res.json();
    if (json.status === "ok") {
      window.playerTiers = json.data || {};
      renderForm(window.playerTiers);
      // 通知 shop.js 更新 tier checkboxes
      document.dispatchEvent(new CustomEvent("playerTiersLoaded", { detail: window.playerTiers }));
    } else {
      window.logActivity && window.logActivity("❌ 無法載入等級設定：" + (json.message || ""));
    }
  }

  function renderForm(tiers) {
    if (!formArea) return;
    const allRoles = (window.state && window.state.roles) ? window.state.roles : [];
    formArea.innerHTML = RANKS.map((rank) => {
      const t = tiers[rank] || { label: `${rank}級`, roleIds: [] };
      return `
        <div class="access-card">
          <h3>${escHtml(t.label || rank + "級")}</h3>
          <label>
            <span>等級名稱</span>
            <input class="tier-label-input" data-rank="${rank}" type="text" value="${escAttr(t.label || rank + "級")}" placeholder="${rank}級" />
          </label>
          <div>
            <span style="font-size:0.85em;font-weight:500;display:block;margin-bottom:6px;">對應身分組（可多選）</span>
            <div class="role-list tier-role-list" data-rank="${rank}" style="max-height:180px;overflow-y:auto;"></div>
            ${allRoles.length === 0 ? `<p style="font-size:0.8em;color:var(--muted);margin-top:4px;">請先連線後台以載入身分組清單</p>` : ""}
          </div>
        </div>`;
    }).join("");

    // 填入 checkbox 清單
    if (allRoles.length > 0 && window.adminBindings) {
      for (const rank of RANKS) {
        const t = tiers[rank] || { roleIds: [] };
        const container = formArea.querySelector(`.tier-role-list[data-rank="${rank}"]`);
        if (container) {
          window.adminBindings.createRoleChecklist(container, allRoles, t.roleIds || []);
        }
      }
    }
  }

  function collectFormData() {
    const payload = {};
    for (const rank of RANKS) {
      const labelEl    = formArea ? formArea.querySelector(`.tier-label-input[data-rank="${rank}"]`) : null;
      const container  = formArea ? formArea.querySelector(`.tier-role-list[data-rank="${rank}"]`) : null;
      payload[rank] = {
        label: labelEl ? labelEl.value.trim() || `${rank}級` : `${rank}級`,
        roleIds: container && window.adminBindings ? window.adminBindings.getSelectedRoleIds(container) : []
      };
    }
    return payload;
  }

  async function saveTiers() {
    const payload = collectFormData();
    const res = await fetch("/admin/player-tiers", {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.status === "ok") {
      window.playerTiers = json.data || {};
      window.logActivity && window.logActivity("✅ 玩家等級設定已儲存");
      document.dispatchEvent(new CustomEvent("playerTiersLoaded", { detail: window.playerTiers }));
    } else {
      window.logActivity && window.logActivity("❌ 儲存失敗：" + (json.message || ""));
    }
  }

  if (saveBtn) saveBtn.addEventListener("click", saveTiers);

  function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return String(s || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // 連線後自動載入（與 shop.js 共用同一事件）
  document.addEventListener("adminConnected", () => {
    loadTiers();
  });

  // bootstrap 時也可以直接注入 tiers（從 admin.core.js 觸發）
  document.addEventListener("bootstrapLoaded", (e) => {
    if (e.detail && e.detail.playerTiers) {
      window.playerTiers = e.detail.playerTiers;
      renderForm(window.playerTiers);
      document.dispatchEvent(new CustomEvent("playerTiersLoaded", { detail: window.playerTiers }));
    }
  });
})();
