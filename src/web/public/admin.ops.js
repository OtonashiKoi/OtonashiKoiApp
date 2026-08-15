(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const fmt = (value) => Number(value || 0).toLocaleString("zh-TW");
  const when = (value) => value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "—";

  function headers(hasBody = false) {
    return {
      Authorization: `Bearer ${window.getAdminToken?.() || ""}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {})
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    return payload.data;
  }

  function donationCard(row) {
    const tradeNo = row.tradeNo || row.MerchantTradeNo || "";
    const status = row.status || "unknown";
    const canAssign = status !== "granted";
    return `<article class="access-card" style="padding:10px;display:grid;gap:6px;">
      <div style="display:flex;justify-content:space-between;gap:8px;"><strong>${esc(tradeNo || "無交易編號")}</strong><span class="mode-chip">${esc(status)}</span></div>
      <div class="hint">${when(row.receivedAt || row.createdAt)}・NT$ ${fmt(row.twdAmount || row.TradeAmt)}・${esc(row.patronName || row.matchedDiscordId || "尚未配對")}</div>
      ${canAssign ? `<button class="button" data-assign-trade="${esc(tradeNo)}">人工指派給玩家</button>` : `<span class="hint">已發放給 ${esc(row.matchedDiscordId || "玩家")}</span>`}
    </article>`;
  }

  async function loadDonations() {
    const root = $("ops-ecpay-list");
    if (!root) return;
    root.innerHTML = '<p class="hint">載入中…</p>';
    try {
      const status = $("ops-ecpay-status")?.value || "";
      const data = await api(`/admin/ecpay/donations?limit=50${status ? `&status=${encodeURIComponent(status)}` : ""}`);
      root.innerHTML = (data.donations || []).map(donationCard).join("") || '<p class="hint">此篩選目前沒有收單。</p>';
    } catch (error) {
      root.innerHTML = `<p class="hint" style="color:var(--danger);">載入失敗：${esc(error.message)}</p>`;
    }
  }

  async function assignDonation(tradeNo) {
    if (!tradeNo) return;
    const discordId = prompt(`輸入要接收這筆收單的 Discord 玩家 ID：\n${tradeNo}`, "")?.trim();
    if (!discordId) return;
    if (!/^\d{17,20}$/.test(discordId)) return alert("Discord 玩家 ID 格式不正確。");
    if (!confirm(`確定把收單 ${tradeNo} 指派給 ${discordId} 並立即補發？\n此操作不能在這個畫面撤銷。`)) return;
    try {
      await api(`/admin/ecpay/donations/${encodeURIComponent(tradeNo)}/assign`, { method: "POST", body: JSON.stringify({ discordId }) });
      window.logActivity?.(`綠界收單 ${tradeNo} 已指派給 ${discordId}`);
      await loadDonations();
    } catch (error) { alert(`指派失敗：${error.message}`); }
  }

  async function updatePassPoints() {
    const discordId = $("ops-pass-player")?.value.trim();
    const points = Number($("ops-pass-points")?.value);
    const set = $("ops-pass-set")?.checked === true;
    const status = $("ops-pass-status");
    if (!/^\d{17,20}$/.test(discordId || "")) return void (status.textContent = "請輸入正確的 Discord 玩家 ID。");
    if (!Number.isFinite(points)) return void (status.textContent = "請輸入有效點數。");
    const verb = set ? `直接設定為 ${fmt(points)}` : `${points >= 0 ? "增加" : "扣除"} ${fmt(Math.abs(points))}`;
    if (!confirm(`確定將 ${discordId} 的通行證點數${verb}？`)) return;
    try {
      status.textContent = "處理中…";
      const data = await api("/admin/pass/add-points", { method: "POST", body: JSON.stringify({ discordId, points, set }) });
      status.textContent = `完成：目前點數 ${fmt(data?.points ?? data?.passPoints ?? points)}`;
      window.logActivity?.(`已更新 ${discordId} 的通行證點數`);
    } catch (error) { status.textContent = `失敗：${error.message}`; }
  }

  function payloadSummary(payload) {
    if (!payload || typeof payload !== "object") return "—";
    if (payload.path) return `${payload.path}・HTTP ${payload.statusCode ?? "—"}・${payload.durationMs ?? "—"}ms`;
    return Object.entries(payload).slice(0, 5).map(([key, value]) => `${key}: ${typeof value === "object" ? "[…]" : value}`).join("・") || "—";
  }

  async function loadAudit() {
    const root = $("audit-log-list");
    if (!root) return;
    root.innerHTML = '<p class="hint">載入中…</p>';
    try {
      const rows = await api("/admin/audit-logs?limit=50");
      root.innerHTML = (rows || []).map((row) => `<article class="access-card" style="padding:10px;display:grid;grid-template-columns:minmax(130px,.8fr) minmax(140px,1fr) minmax(220px,2fr);gap:8px;align-items:start;">
        <span>${when(row.createdAt)}</span><strong>${esc(row.actionType || "admin-action")}</strong><span>${esc(payloadSummary(row.payload))}${row.targetPlayerId ? `<br><small>玩家：${esc(row.targetPlayerId)}</small>` : ""}</span>
      </article>`).join("") || '<p class="hint">目前沒有伺服器稽核紀錄。</p>';
    } catch (error) { root.innerHTML = `<p class="hint" style="color:var(--danger);">載入失敗：${esc(error.message)}</p>`; }
  }

  document.addEventListener("click", (event) => {
    const assign = event.target.closest("[data-assign-trade]");
    if (assign) assignDonation(assign.dataset.assignTrade);
  });
  $("ops-refresh")?.addEventListener("click", loadDonations);
  $("ops-ecpay-status")?.addEventListener("change", loadDonations);
  $("ops-pass-submit")?.addEventListener("click", updatePassPoints);
  $("audit-refresh")?.addEventListener("click", loadAudit);
  document.querySelector('[data-target="section-ops"]')?.addEventListener("click", () => setTimeout(loadDonations, 0));
  document.querySelector('[data-target="section-log"]')?.addEventListener("click", () => setTimeout(loadAudit, 0));
  document.addEventListener("adminConnected", () => {
    if ($("section-ops")?.classList.contains("active")) loadDonations();
    if ($("section-log")?.classList.contains("active")) loadAudit();
  });
})();
