// 後台：🎡 直播轉盤設定（VTuber 抽選轉盤）
// 多轉盤管理；項目（名稱/權重/顏色）存 MongoDB streamWheels；overlay 網址給 OBS 瀏覽器來源用。
(function () {
  const root = document.getElementById("wheel-admin-root");
  if (!root) return;

  const PALETTE = ["#3b5fd0", "#f5d060", "#7ce0ff", "#ff8ab8", "#6ee7b7", "#c4b5fd", "#ff8a4a", "#8fb6ff", "#ffd166", "#5eead4"];

  function headers() {
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (window.getAdminToken?.() || "")
    };
  }
  async function api(method, path, body = null) {
    const res = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.status !== "ok") throw new Error(json?.message || `HTTP ${res.status}`);
    return json.data;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let wheels = [];
  let cur = null; // 編輯中的轉盤（複本）

  async function load() {
    try {
      wheels = await api("GET", "/admin/wheel/list");
      if (!cur && wheels.length) cur = JSON.parse(JSON.stringify(wheels[0]));
      render();
    } catch (e) {
      root.innerHTML = `<p class="hint" style="color:#ff8a8a">載入失敗：${esc(e.message)}（請先在上方登入後台）</p>
        <button class="button" id="wheel-retry">重試</button>`;
      document.getElementById("wheel-retry")?.addEventListener("click", load);
    }
  }

  function overlayUrl(id) {
    return `${location.origin}/static/wheel.html?id=${encodeURIComponent(id)}`;
  }

  function render() {
    const totalW = (cur?.items || []).reduce((s, it) => s + (Number(it.weight) || 1), 0) || 1;
    root.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
        <select id="wh-select" class="input" style="max-width:220px;">
          ${wheels.map((w) => `<option value="${esc(w.id)}" ${cur?.id === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}
          ${wheels.length === 0 ? '<option value="">（尚無轉盤）</option>' : ""}
        </select>
        <button class="button" id="wh-new">➕ 新增轉盤</button>
        ${cur?.id ? '<button class="button danger" id="wh-del">🗑 刪除此轉盤</button>' : ""}
      </div>

      ${cur ? `
      <div class="panel-block" style="margin-bottom:12px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
          <label>轉盤名稱<br><input id="wh-name" class="input" value="${esc(cur.name)}" maxlength="30" style="width:200px;"></label>
          <label>旋轉秒數（3~15）<br><input id="wh-secs" class="input" type="number" min="3" max="15" value="${Number(cur.spinSeconds) || 6}" style="width:90px;"></label>
          <label style="display:flex; align-items:center; gap:6px; padding-bottom:6px;">
            <input id="wh-history" type="checkbox" ${cur.showHistory !== false ? "checked" : ""}> 顯示歷史紀錄（左下角）
          </label>
        </div>
      </div>

      <table class="table" style="width:100%; margin-bottom:10px;">
        <thead><tr><th style="width:44%">項目名稱</th><th style="width:14%">權重</th><th style="width:12%">機率</th><th style="width:12%">顏色</th><th></th></tr></thead>
        <tbody id="wh-items">
          ${(cur.items || []).map((it, i) => `
            <tr data-i="${i}">
              <td><input class="input wh-label" value="${esc(it.label)}" maxlength="40" placeholder="例：唱一首歌"></td>
              <td><input class="input wh-weight" type="number" min="1" max="1000" value="${Number(it.weight) || 1}" style="width:70px;"></td>
              <td class="hint">${((Number(it.weight) || 1) / totalW * 100).toFixed(1)}%</td>
              <td><input class="wh-color" type="color" value="${esc(it.color || PALETTE[i % PALETTE.length])}" style="width:44px; height:30px; border:none; background:none; cursor:pointer;"></td>
              <td style="white-space:nowrap;">
                <button class="button wh-up" title="上移">↑</button>
                <button class="button wh-down" title="下移">↓</button>
                <button class="button danger wh-rm" title="刪除">✕</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        <button class="button" id="wh-add">➕ 新增項目</button>
        <button class="button primary" id="wh-save">💾 儲存轉盤</button>
        <span class="hint" id="wh-msg" style="align-self:center;"></span>
      </div>

      ${cur.id ? `
      <div class="panel-block">
        <h3 style="margin-bottom:6px;">📡 OBS 嵌入</h3>
        <p class="hint">OBS「瀏覽器來源」貼上網址（建議 720×820）；背景透明。點轉盤或按空白鍵旋轉；改完設定 30 秒內自動同步，或在 overlay 按 R 立即更新。</p>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px;">
          <code id="wh-url" style="background:rgba(0,0,0,0.3); padding:6px 10px; border-radius:4px; word-break:break-all;">${esc(overlayUrl(cur.id))}</code>
          <button class="button" id="wh-copy">📋 複製網址</button>
          <a class="button" href="${esc(overlayUrl(cur.id))}&bg=1" target="_blank">🔍 開新視窗預覽</a>
        </div>
      </div>` : '<p class="hint">先儲存一次，才會產生 OBS 網址。</p>'}
      ` : '<p class="hint">按「➕ 新增轉盤」開始。</p>'}
    `;
    bind();
  }

  // 從畫面收集目前編輯狀態（存回 cur，重繪不掉字）
  function collect() {
    if (!cur) return;
    cur.name = document.getElementById("wh-name")?.value ?? cur.name;
    cur.spinSeconds = Number(document.getElementById("wh-secs")?.value) || 6;
    cur.showHistory = !!document.getElementById("wh-history")?.checked;
    const rows = [...root.querySelectorAll("#wh-items tr")];
    cur.items = rows.map((tr) => ({
      label: tr.querySelector(".wh-label").value.trim(),
      weight: Math.max(1, Math.min(1000, Math.round(Number(tr.querySelector(".wh-weight").value) || 1))),
      color: tr.querySelector(".wh-color").value
    }));
  }

  function bind() {
    document.getElementById("wh-select")?.addEventListener("change", (e) => {
      const w = wheels.find((x) => x.id === e.target.value);
      if (w) { cur = JSON.parse(JSON.stringify(w)); render(); }
    });
    document.getElementById("wh-new")?.addEventListener("click", () => {
      cur = { id: "", name: "新轉盤", spinSeconds: 6, showHistory: true,
        items: [{ label: "項目 1", weight: 1, color: PALETTE[0] }, { label: "項目 2", weight: 1, color: PALETTE[1] }] };
      render();
    });
    document.getElementById("wh-del")?.addEventListener("click", async () => {
      if (!cur?.id || !confirm(`確定刪除轉盤「${cur.name}」？此動作無法復原。`)) return;
      try {
        await api("POST", "/admin/wheel/delete", { id: cur.id });
        cur = null;
        await load();
      } catch (e) { alert("刪除失敗：" + e.message); }
    });
    document.getElementById("wh-add")?.addEventListener("click", () => {
      collect();
      cur.items.push({ label: "", weight: 1, color: PALETTE[cur.items.length % PALETTE.length] });
      render();
    });
    document.getElementById("wh-save")?.addEventListener("click", async () => {
      collect();
      const items = cur.items.filter((it) => it.label);
      if (!items.length) return alert("至少要有 1 個有名稱的項目");
      try {
        const saved = await api("POST", "/admin/wheel/save", { ...cur, items });
        cur.id = saved.id;
        const msg = document.getElementById("wh-msg");
        if (msg) { msg.textContent = "✅ 已儲存"; setTimeout(() => { msg.textContent = ""; }, 2500); }
        await load();
      } catch (e) { alert("儲存失敗：" + e.message); }
    });
    document.getElementById("wh-copy")?.addEventListener("click", () => {
      navigator.clipboard.writeText(overlayUrl(cur.id)).then(() => {
        const msg = document.getElementById("wh-msg");
        if (msg) { msg.textContent = "📋 已複製"; setTimeout(() => { msg.textContent = ""; }, 2000); }
      });
    });
    // 權重改動 → 機率欄即時更新（整表重算重繪）
    root.querySelectorAll(".wh-weight").forEach((inp) => inp.addEventListener("change", () => { collect(); render(); }));
    root.querySelectorAll(".wh-rm").forEach((btn) => btn.addEventListener("click", (e) => {
      collect();
      cur.items.splice(Number(e.target.closest("tr").dataset.i), 1);
      render();
    }));
    root.querySelectorAll(".wh-up").forEach((btn) => btn.addEventListener("click", (e) => {
      collect();
      const i = Number(e.target.closest("tr").dataset.i);
      if (i > 0) { [cur.items[i - 1], cur.items[i]] = [cur.items[i], cur.items[i - 1]]; render(); }
    }));
    root.querySelectorAll(".wh-down").forEach((btn) => btn.addEventListener("click", (e) => {
      collect();
      const i = Number(e.target.closest("tr").dataset.i);
      if (i < cur.items.length - 1) { [cur.items[i + 1], cur.items[i]] = [cur.items[i], cur.items[i + 1]]; render(); }
    }));
  }

  // 切到本分頁或登入完成時才載入，避免登入畫面尚未輸入密碼就先產生 401。
  document.querySelector('[data-target="section-wheel"]')?.addEventListener("click", load);
  document.addEventListener("adminConnected", () => {
    if (document.getElementById("section-wheel")?.classList.contains("active")) load();
  });
  window.adminWheel = { load };
})();
