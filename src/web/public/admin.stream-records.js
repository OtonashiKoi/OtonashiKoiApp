// 後台：直播記錄檢視（唯讀）
// 三個分頁：斗內事件流水 / 會員變動流水 / 會員現況
(function () {
  const root = document.getElementById("stream-records-root");
  if (!root) return;

  function headers() {
    return { Authorization: "Bearer " + (window.elements?.adminPassword?.value?.trim() || "") };
  }
  async function fetchJSON(url) {
    const res = await fetch(url, { headers: headers() });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data?.data ?? data;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtTime = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("zh-TW", { hour12: false }); } catch (_) { return String(iso); }
  };

  const EVENT_LABEL = {
    join: "🟢 加入", rejoin: "🔁 回鍋", expire: "🔴 到期/掉會員",
    upgrade: "⬆️ 升級", downgrade: "⬇️ 降級", role_change: "🔧 身分組變動"
  };

  let tab = "donations"; // donations | memberships | status

  function tabBar() {
    const btn = (key, label) =>
      `<button class="button ${tab === key ? "primary" : ""}" data-sr-tab="${key}" style="margin-right:6px;">${label}</button>`;
    return `<div style="margin-bottom:12px;">
      ${btn("donations", "💸 斗內記錄")}
      ${btn("memberships", "👑 會員變動")}
      ${btn("status", "📋 會員現況")}
      <button class="button" id="sr-refresh" style="margin-left:6px;">🔄 重新載入</button>
    </div>`;
  }

  async function renderDonations() {
    const { events, summary } = await fetchJSON("/admin/stream-records/donations?limit=200");
    const s = summary || {};
    const rows = (events || []).map((e) => `
      <tr>
        <td style="white-space:nowrap;">${esc(fmtTime(e.createdAt))}</td>
        <td>${esc(e.displayName)}${e.isMember ? ' <span style="color:#7ee0a0;">會員</span>' : ""}</td>
        <td style="text-align:right;">NT$${esc(e.twdAmount)}</td>
        <td style="text-align:right;">${e.diamondsGranted > 0 ? "💎" + esc(e.diamondsGranted) : "—"}</td>
        <td style="text-align:right;">${e.pendingAfter > 0 ? "NT$" + esc(e.pendingAfter) : "—"}</td>
        <td>${e.bound ? '<span style="color:#7ee0a0;">✔ 已綁定</span>' : '<span style="color:#ffb066;">未綁定</span>'}</td>
        <td class="hint" style="font-size:11px;">${esc(e.platform)} · ${esc(e.note || "")}</td>
      </tr>`).join("");
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        ${statCard("總事件數", s.totalEvents || 0)}
        ${statCard("已綁定事件", s.boundEvents || 0)}
        ${statCard("累計金額", "NT$" + (s.totalTwd || 0))}
        ${statCard("累計發鑽", "💎" + (s.totalDiamonds || 0))}
      </div>
      <div style="overflow:auto;">
      <table class="admin-table" style="width:100%;font-size:13px;">
        <thead><tr><th>時間</th><th>觀眾</th><th style="text-align:right;">金額</th><th style="text-align:right;">發鑽</th><th style="text-align:right;">零頭</th><th>綁定</th><th>來源/備註</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="hint">尚無斗內記錄。等下一筆 SC 進來就會出現在這裡。</td></tr>'}</tbody>
      </table>
      </div>`;
  }

  async function renderMemberships() {
    const { events } = await fetchJSON("/admin/stream-records/memberships?limit=200");
    const rows = (events || []).map((e) => `
      <tr>
        <td style="white-space:nowrap;">${esc(fmtTime(e.at))}</td>
        <td>${esc(e.displayName || e.discordId)}</td>
        <td>${EVENT_LABEL[e.event] || esc(e.event)}</td>
        <td>${esc(e.fromLabel || e.fromTier || "無")} → ${esc(e.toLabel || e.toTier || "無")}</td>
        <td class="hint" style="font-size:11px;">${esc(e.source || "")}</td>
      </tr>`).join("");
    return `
      <p class="hint" style="margin-bottom:10px;">會員(等級身分組)加入 / 到期 / 升降級即時流水。續約(renew)因 Discord 身分組會一直掛著、抓不到離散事件，需之後接 YouTube 會員 API 到期日比對。</p>
      <div style="overflow:auto;">
      <table class="admin-table" style="width:100%;font-size:13px;">
        <thead><tr><th>時間</th><th>成員</th><th>事件</th><th>等級變化</th><th>來源</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="hint">尚無會員變動記錄。有人上/下會員身分組時就會出現。</td></tr>'}</tbody>
      </table>
      </div>`;
  }

  async function renderStatus() {
    const { statuses, activeCount, total } = await fetchJSON("/admin/stream-records/membership-status?limit=1000");
    const rows = (statuses || []).map((s) => `
      <tr>
        <td>${esc(s.displayName || s.discordId)}</td>
        <td>${s.isMember ? '<span style="color:#7ee0a0;">' + esc(s.currentLabel || s.currentTier || "會員") + "</span>" : '<span class="hint">非會員</span>'}</td>
        <td style="white-space:nowrap;">${esc(fmtTime(s.firstJoinedAt))}</td>
        <td style="white-space:nowrap;">${esc(fmtTime(s.lastChangedAt))}</td>
        <td>${EVENT_LABEL[s.lastEvent] || esc(s.lastEvent || "")}</td>
      </tr>`).join("");
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        ${statCard("目前會員數", activeCount || 0)}
        ${statCard("追蹤總人數", total || 0)}
      </div>
      <div style="overflow:auto;">
      <table class="admin-table" style="width:100%;font-size:13px;">
        <thead><tr><th>成員</th><th>目前等級</th><th>首次加入</th><th>最後變動</th><th>最後事件</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="hint">尚無會員現況資料。</td></tr>'}</tbody>
      </table>
      </div>`;
  }

  function statCard(label, value) {
    return `<div style="background:#171b2c;border:1px solid #2b3350;border-radius:12px;padding:10px 16px;min-width:110px;">
      <div class="hint" style="font-size:11px;">${esc(label)}</div>
      <div style="font-size:20px;font-weight:800;color:#f3ecff;">${esc(value)}</div>
    </div>`;
  }

  async function render() {
    root.innerHTML = tabBar() + '<p class="hint">載入中…</p>';
    try {
      let body = "";
      if (tab === "donations") body = await renderDonations();
      else if (tab === "memberships") body = await renderMemberships();
      else body = await renderStatus();
      root.innerHTML = tabBar() + body;
    } catch (e) {
      root.innerHTML = tabBar() + `<p class="hint" style="color:#ff9a8f;">載入失敗：${esc(e.message)}<br>（多半是尚未登入。請先到「基礎設定 → 登入連線」輸入管理員密碼並連線，再回本頁。）</p>`;
    }
  }

  // 事件委派（nav 可能被搜尋重建）
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest?.("[data-sr-tab]");
    if (tabBtn) { tab = tabBtn.dataset.srTab; render(); return; }
    if (e.target.closest?.("#sr-refresh")) { render(); return; }
    if (e.target.closest?.('[data-target="section-stream-records"]')) setTimeout(render, 60);
  });
  const sec = document.getElementById("section-stream-records");
  if (sec) {
    const obs = new MutationObserver(() => { if (sec.classList.contains("active")) render(); });
    obs.observe(sec, { attributes: true, attributeFilter: ["class"] });
    if (sec.classList.contains("active")) render();
  }
})();
