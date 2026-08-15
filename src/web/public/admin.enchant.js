// 後台：附魔設定（數值範圍 / 每階條數）
(function () {
  const root = document.getElementById("enchant-config-root");
  if (!root) return;

  // 與其他後台頁一致：用官方 getAdminToken()（登入後的密碼來源）
  const adminToken = () => (window.getAdminToken ? window.getAdminToken() : (window.elements?.adminPassword?.value?.trim() || ""));
  const headers = () => ({ Authorization: "Bearer " + adminToken() });
  async function fetchJSON(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data?.data ?? data;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const BAND_ORDER = ["D", "C", "B", "AS"];
  const TIER_ORDER = ["D", "C", "B", "A", "S"];
  let cfg = null;

  function render() {
    // 未登入(無 token)不要硬打 API 造成「Invalid admin password」；提示先登入。
    if (!adminToken()) {
      root.innerHTML = '<p class="hint">請先到「基礎設定 → 登入連線」輸入管理員密碼並連線，登入後本頁會自動載入。</p>';
      return;
    }
    root.innerHTML = '<p class="hint">載入中…</p>';
    fetchJSON("/admin/enchant/config", { headers: headers() }).then((c) => {
      cfg = c;
      const bandsHtml = BAND_ORDER.map((bk) => {
        const band = cfg.bands[bk]; if (!band) return "";
        const rows = (band.attrs || []).map((a, i) => `
          <tr>
            <td>${esc(a.label)} <span class="hint" style="font-size:10px;">${esc(a.key)}${a.effectKey ? " → " + esc(a.effectKey) : ""}</span></td>
            <td>${a.unit === "%" ? "%" : "點"}</td>
            <td><input type="number" data-band="${bk}" data-idx="${i}" data-f="min" value="${esc(a.min)}" style="width:64px;"></td>
            <td><input type="number" data-band="${bk}" data-idx="${i}" data-f="max" value="${esc(a.max)}" style="width:64px;"></td>
          </tr>`).join("");
        return `
          <div class="card" style="margin-bottom:12px;">
            <h3 style="margin:0 0 6px;">${esc(bk)} 池 · ${esc(band.label || "")}</h3>
            <table class="admin-table" style="width:100%;font-size:13px;">
              <thead><tr><th>屬性</th><th>單位</th><th>最小</th><th>最大</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }).join("");

      const lineHtml = TIER_ORDER.map((t) => `
        <label style="display:inline-flex;flex-direction:column;font-size:12px;margin:0 12px 8px 0;">${t} 階條數
          <input type="number" data-line="${t}" value="${esc(cfg.lineCountByTier?.[t] ?? 0)}" style="width:64px;margin-top:3px;"></label>`).join("");

      const rollHtml = TIER_ORDER.map((t) => `${t}→[${esc((cfg.rollableBandsByTier?.[t] || []).join(","))}]`).join("　");

      root.innerHTML = `
        <p class="hint" style="margin-bottom:10px;">調整各附魔池的數值範圍(min~max)與每階條數。儲存後<b>即時生效</b>（免重啟）。基礎屬性=點數；衍生詞條=%（對應效果引擎 key）。</p>
        <div class="card" style="margin-bottom:12px;">
          <h3 style="margin:0 0 6px;">每階附魔條數</h3>
          <div>${lineHtml}</div>
          <p class="hint" style="font-size:11px;margin-top:4px;">可骰 band（累積制，唯讀）：${rollHtml}</p>
        </div>
        ${bandsHtml}
        <button class="button primary" id="enchant-save">💾 儲存並套用</button>
      `;
    }).catch((e) => {
      root.innerHTML = `<p class="hint" style="color:#ff9a8f;">載入失敗：${esc(e.message)}（請先到「基礎設定 → 登入連線」輸入密碼）</p>`;
    });
  }

  async function save() {
    if (!cfg) return;
    // 收集 min/max
    root.querySelectorAll("input[data-band]").forEach((inp) => {
      const bk = inp.dataset.band, idx = Number(inp.dataset.idx), f = inp.dataset.f;
      const attr = cfg.bands[bk]?.attrs?.[idx];
      if (attr) attr[f] = Math.max(0, Number(inp.value) || 0);
    });
    // 收集條數
    root.querySelectorAll("input[data-line]").forEach((inp) => {
      cfg.lineCountByTier[inp.dataset.line] = Math.max(0, Number(inp.value) || 0);
    });
    try {
      await fetchJSON("/admin/enchant/config", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ bands: cfg.bands, lineCountByTier: cfg.lineCountByTier })
      });
      alert("✅ 已儲存並即時套用");
      render();
    } catch (e) { alert("儲存失敗：" + e.message); }
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest?.("#enchant-save")) { save(); return; }
    if (e.target.closest?.('[data-target="section-enchant"]')) setTimeout(render, 60);
  });
  // 登入成功後自動載入（與其他後台頁一致）
  document.addEventListener("adminConnected", () => { if (document.getElementById("section-enchant")?.classList.contains("active")) render(); });
  const sec = document.getElementById("section-enchant");
  if (sec) {
    const obs = new MutationObserver(() => { if (sec.classList.contains("active")) render(); });
    obs.observe(sec, { attributes: true, attributeFilter: ["class"] });
    if (sec.classList.contains("active")) render();
  }
})();
