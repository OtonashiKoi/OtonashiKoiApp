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
      ${btn("events", "🎉 全服活動")}
      <button class="button" id="sr-refresh" style="margin-left:6px;">🔄 重新載入</button>
      ${(tab === "memberships" || tab === "status") ? '<button class="button" id="sr-sync" style="margin-left:6px;">🔁 立即同步會員名單</button>' : ""}
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

  async function renderEvents() {
    const [cfgWrap, buffs, scp] = await Promise.all([
      fetchJSON("/admin/stream-events/config"),
      fetchJSON("/admin/stream-events/buffs"),
      fetchJSON("/admin/stream-events/sc-bar")
    ]);
    const c = (cfgWrap && cfgWrap.donationBuff) || {};
    const scCfg = (cfgWrap && cfgWrap.scBar) || { enabled: false, milestones: [] };
    const mod = buffs.modifiers || { dropPct: 0, goldPct: 0, expPct: 0 };
    const active = buffs.active || [];
    const num = (id, label, val, suffix) =>
      `<label style="display:inline-flex;flex-direction:column;font-size:12px;margin:0 10px 8px 0;">${esc(label)}<input id="${id}" type="number" value="${esc(val)}" style="width:90px;padding:4px 6px;margin-top:3px;">${suffix ? `<span class="hint" style="font-size:10px;">${suffix}</span>` : ""}</label>`;
    const activeRows = active.map((b) => `
      <tr><td>${esc(b.label)}</td>
        <td>${b.dropPct > 0 ? "掉寶+" + esc(b.dropPct) + "% " : ""}${b.goldPct > 0 ? "金幣+" + esc(b.goldPct) + "% " : ""}${b.expPct > 0 ? "經驗+" + esc(b.expPct) + "%" : ""}</td>
        <td class="hint" style="font-size:11px;">${esc(b.source)}</td>
        <td style="white-space:nowrap;">至 ${esc(fmtTime(b.endsAt))}</td>
        <td><button class="button" data-buff-clear="${esc(b.id)}" style="padding:2px 8px;font-size:11px;">結束</button></td></tr>`).join("");

    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
        ${statCard("目前掉寶加成", "+" + (mod.dropPct || 0) + "%")}
        ${statCard("目前金幣加成", "+" + (mod.goldPct || 0) + "%")}
        ${statCard("目前經驗加成", "+" + (mod.expPct || 0) + "%")}
        ${statCard("生效中 Buff", active.length)}
      </div>

      <div class="card" style="margin-bottom:14px;">
        <h3 style="margin:0 0 4px;">⚡ 手動發全服 Buff（活動 / 測試）</h3>
        <p class="hint" style="margin:0 0 10px;">立即對全服套用一個限時加成，馬上生效於所有戰鬥/掛機。</p>
        <div>
          <label style="display:inline-flex;flex-direction:column;font-size:12px;margin:0 10px 8px 0;">名稱<input id="mb-label" value="全服活動加成" style="width:160px;padding:4px 6px;margin-top:3px;"></label>
          ${num("mb-drop", "掉寶 +%", 20)}
          ${num("mb-gold", "金幣 +%", 0)}
          ${num("mb-exp", "經驗 +%", 0)}
          ${num("mb-dur", "持續(分)", 60)}
          <label style="display:inline-flex;align-items:center;font-size:12px;margin:0 10px;"><input id="mb-announce" type="checkbox" checked style="margin-right:4px;">全服廣播</label>
        </div>
        <button class="button primary" id="mb-send" style="margin-top:6px;">🚀 立即發送</button>
        ${active.length ? '<button class="button" id="mb-clearall" style="margin-top:6px;margin-left:8px;">🧹 全部結束</button>' : ""}
        ${active.length ? `<div style="overflow:auto;margin-top:12px;"><table class="admin-table" style="width:100%;font-size:13px;"><thead><tr><th>名稱</th><th>效果</th><th>來源</th><th>結束時間</th><th></th></tr></thead><tbody>${activeRows}</tbody></table></div>` : ""}
      </div>

      <div class="card">
        <h3 style="margin:0 0 4px;">💸 斗內自動觸發設定</h3>
        <p class="hint" style="margin:0 0 10px;">觀眾單筆斗內達門檻時，自動對全服套用加成。<b>先填好數字、勾「啟用」再儲存</b>；未啟用時斗內不會觸發（記錄照常）。</p>
        <div>
          <label style="display:inline-flex;align-items:center;font-size:13px;margin:0 14px 10px 0;font-weight:700;"><input id="db-enabled" type="checkbox" ${c.enabled ? "checked" : ""} style="margin-right:6px;">啟用斗內觸發</label>
        </div>
        <div>
          ${num("db-min", "觸發門檻 NT$", c.minTwd, "單筆≥此金額")}
          ${num("db-drop", "掉寶 +%", c.dropPct)}
          ${num("db-gold", "金幣 +%", c.goldPct)}
          ${num("db-exp", "經驗 +%", c.expPct)}
          ${num("db-dur", "持續(分)", c.durationMinutes)}
          <label style="display:inline-flex;align-items:center;font-size:12px;margin:0 10px;"><input id="db-announce" type="checkbox" ${c.announce ? "checked" : ""} style="margin-right:4px;">全服廣播</label>
        </div>
        <button class="button primary" id="db-save" style="margin-top:6px;">💾 儲存設定</button>
      </div>

      ${scBarCard(scp, scCfg)}`;
  }

  function scBarCard(scp, cfg) {
    const total = scp.total || 0;
    const maxT = scp.maxThreshold || 0;
    const pct = maxT > 0 ? Math.min(100, Math.round((total / maxT) * 100)) : 0;
    const markers = (scp.milestones || []).map((m) => {
      const left = maxT > 0 ? Math.min(100, (m.threshold / maxT) * 100) : 0;
      return `<div title="${esc(m.label)} (NT$${esc(m.threshold)})" style="position:absolute;left:${left}%;top:-2px;transform:translateX(-50%);font-size:14px;">${m.claimed ? "✅" : "🔒"}</div>`;
    }).join("");
    const rows = (cfg.milestones || []).map((m, i) => `
      <tr data-ms-row="${i}" data-ms-id="${esc(m.id || "")}">
        <td><input data-ms="threshold" type="number" value="${esc(m.threshold)}" style="width:80px;"></td>
        <td><input data-ms="label" value="${esc(m.label || "")}" style="width:120px;"></td>
        <td><input data-ms="dropPct" type="number" value="${esc(m.dropPct || 0)}" style="width:56px;"></td>
        <td><input data-ms="goldPct" type="number" value="${esc(m.goldPct || 0)}" style="width:56px;"></td>
        <td><input data-ms="expPct" type="number" value="${esc(m.expPct || 0)}" style="width:56px;"></td>
        <td><input data-ms="durationMinutes" type="number" value="${esc(m.durationMinutes || 60)}" style="width:56px;"></td>
        <td><button class="button" data-ms-del="${i}" style="padding:2px 8px;font-size:11px;">✕</button></td>
      </tr>`).join("");
    return `
      <div class="card" style="margin-top:14px;">
        <h3 style="margin:0 0 4px;">📊 SC 累積條</h3>
        <p class="hint" style="margin:0 0 10px;">全服斗內累積，跨里程碑就解鎖全服加成。<b>累積永遠會計算+顯示</b>；勾「啟用」後跨門檻才真的發獎。清除用下方「重置」（之後可再改自動清除策略）。</p>
        <div style="margin:6px 0 4px;font-weight:800;font-size:15px;">目前累積：NT$${esc(total)} ${maxT ? `<span class="hint" style="font-weight:400;">/ 最高 NT$${esc(maxT)}（${pct}%）</span>` : ""}</div>
        <div style="position:relative;height:14px;background:#20273c;border-radius:8px;margin:14px 0 10px;">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:linear-gradient(90deg,#5b67ff,#a26bff);border-radius:8px;"></div>
          ${markers}
        </div>
        ${scp.nextMilestone ? `<p class="hint">下一目標：NT$${esc(scp.nextMilestone.threshold)}（還差 NT$${esc(scp.nextMilestone.threshold - total)}）→ ${esc(scp.nextMilestone.label)}</p>` : '<p class="hint">已達最高里程碑（或尚未設定里程碑）。</p>'}
        <label style="display:inline-flex;align-items:center;font-size:13px;margin:6px 0 8px;font-weight:700;"><input id="sc-enabled" type="checkbox" ${cfg.enabled ? "checked" : ""} style="margin-right:6px;">啟用里程碑發獎</label>
        <div style="overflow:auto;">
          <table class="admin-table" id="sc-ms-table" style="width:100%;font-size:12px;">
            <thead><tr><th>門檻NT$</th><th>名稱</th><th>掉寶%</th><th>金幣%</th><th>經驗%</th><th>時長(分)</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <button class="button" id="sc-add" style="margin-top:6px;">➕ 新增里程碑</button>
        <button class="button primary" id="sc-save" style="margin-top:6px;">💾 儲存里程碑</button>
        <button class="button" id="sc-reset" style="margin-top:6px;margin-left:8px;">🧹 重置累積條</button>
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
      else if (tab === "events") body = await renderEvents();
      else body = await renderStatus();
      root.innerHTML = tabBar() + body;
    } catch (e) {
      root.innerHTML = tabBar() + `<p class="hint" style="color:#ff9a8f;">載入失敗：${esc(e.message)}<br>（多半是尚未登入。請先到「基礎設定 → 登入連線」輸入管理員密碼並連線，再回本頁。）</p>`;
    }
  }

  async function syncNow() {
    const btn = document.getElementById("sr-sync");
    if (btn) { btn.disabled = true; btn.textContent = "同步中…"; }
    try {
      const res = await fetch("/admin/stream-records/reconcile", { method: "POST", headers: headers() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      const s = data?.data || {};
      alert(`✅ 同步完成\n目前會員：${s.currentMembers ?? "?"} 人\n新捕捉加入：${s.joins ?? 0}\n等級變動：${s.changes ?? 0}\n到期(掉身分組)：${s.expiries ?? 0}`);
      render();
    } catch (e) {
      alert("同步失敗：" + e.message);
      if (btn) { btn.disabled = false; btn.textContent = "🔁 立即同步會員名單"; }
    }
  }

  async function postJSON(url, body) {
    const res = await fetch(url, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data?.data ?? data;
  }
  const val = (id) => document.getElementById(id)?.value;
  const chk = (id) => !!document.getElementById(id)?.checked;

  async function sendManualBuff() {
    try {
      await postJSON("/admin/stream-events/buff", {
        label: val("mb-label"), dropPct: Number(val("mb-drop")) || 0, goldPct: Number(val("mb-gold")) || 0,
        expPct: Number(val("mb-exp")) || 0, durationMinutes: Number(val("mb-dur")) || 60, announce: chk("mb-announce")
      });
      alert("✅ 已發送全服 Buff！");
      render();
    } catch (e) { alert("發送失敗：" + e.message); }
  }
  async function clearBuffs(id) {
    if (!confirm(id ? "確定結束這個 Buff？" : "確定結束所有生效中的 Buff？")) return;
    try { await postJSON("/admin/stream-events/buff/clear", id ? { id } : {}); render(); }
    catch (e) { alert("結束失敗：" + e.message); }
  }
  async function saveDonationCfg() {
    try {
      await postJSON("/admin/stream-events/config", {
        donationBuff: {
          enabled: chk("db-enabled"), minTwd: Number(val("db-min")) || 0, dropPct: Number(val("db-drop")) || 0,
          goldPct: Number(val("db-gold")) || 0, expPct: Number(val("db-exp")) || 0,
          durationMinutes: Number(val("db-dur")) || 60, announce: chk("db-announce")
        }
      });
      alert("✅ 斗內觸發設定已儲存" + (chk("db-enabled") ? "（已啟用）" : "（目前未啟用）"));
      render();
    } catch (e) { alert("儲存失敗：" + e.message); }
  }

  function addMilestoneRow() {
    const tb = document.querySelector("#sc-ms-table tbody");
    if (!tb) return;
    const tr = document.createElement("tr");
    tr.setAttribute("data-ms-id", "");
    tr.innerHTML = `
      <td><input data-ms="threshold" type="number" value="1000" style="width:80px;"></td>
      <td><input data-ms="label" value="新里程碑" style="width:120px;"></td>
      <td><input data-ms="dropPct" type="number" value="0" style="width:56px;"></td>
      <td><input data-ms="goldPct" type="number" value="0" style="width:56px;"></td>
      <td><input data-ms="expPct" type="number" value="0" style="width:56px;"></td>
      <td><input data-ms="durationMinutes" type="number" value="60" style="width:56px;"></td>
      <td><button class="button" data-ms-del="new" style="padding:2px 8px;font-size:11px;">✕</button></td>`;
    tb.appendChild(tr);
  }
  function collectMilestones() {
    const rows = [...document.querySelectorAll("#sc-ms-table tbody tr")];
    return rows.map((tr) => {
      const g = (k) => tr.querySelector(`[data-ms="${k}"]`)?.value;
      return {
        id: tr.getAttribute("data-ms-id") || undefined,
        threshold: Number(g("threshold")) || 0,
        label: g("label") || "",
        dropPct: Number(g("dropPct")) || 0,
        goldPct: Number(g("goldPct")) || 0,
        expPct: Number(g("expPct")) || 0,
        durationMinutes: Number(g("durationMinutes")) || 60
      };
    }).filter((m) => m.threshold > 0);
  }
  async function saveScBar() {
    try {
      await postJSON("/admin/stream-events/config", {
        scBar: { enabled: chk("sc-enabled"), milestones: collectMilestones() }
      });
      alert("✅ SC 累積條設定已儲存" + (chk("sc-enabled") ? "（里程碑已啟用）" : "（里程碑未啟用）"));
      render();
    } catch (e) { alert("儲存失敗：" + e.message); }
  }
  async function resetScBar() {
    if (!confirm("確定把 SC 累積條歸零？（會存檔到歷史）")) return;
    try { await postJSON("/admin/stream-events/sc-bar/reset", {}); render(); }
    catch (e) { alert("重置失敗：" + e.message); }
  }

  // 事件委派（nav 可能被搜尋重建）
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest?.("[data-sr-tab]");
    if (tabBtn) { tab = tabBtn.dataset.srTab; render(); return; }
    if (e.target.closest?.("#sr-refresh")) { render(); return; }
    if (e.target.closest?.("#sr-sync")) { syncNow(); return; }
    if (e.target.closest?.("#mb-send")) { sendManualBuff(); return; }
    if (e.target.closest?.("#mb-clearall")) { clearBuffs(); return; }
    if (e.target.closest?.("#db-save")) { saveDonationCfg(); return; }
    if (e.target.closest?.("#sc-add")) { addMilestoneRow(); return; }
    if (e.target.closest?.("#sc-save")) { saveScBar(); return; }
    if (e.target.closest?.("#sc-reset")) { resetScBar(); return; }
    const msDel = e.target.closest?.("[data-ms-del]");
    if (msDel) { msDel.closest("tr")?.remove(); return; }
    const clr = e.target.closest?.("[data-buff-clear]");
    if (clr) { clearBuffs(clr.dataset.buffClear); return; }
    if (e.target.closest?.('[data-target="section-stream-records"]')) setTimeout(render, 60);
  });
  const sec = document.getElementById("section-stream-records");
  if (sec) {
    const obs = new MutationObserver(() => { if (sec.classList.contains("active")) render(); });
    obs.observe(sec, { attributes: true, attributeFilter: ["class"] });
    if (sec.classList.contains("active")) render();
  }
})();
