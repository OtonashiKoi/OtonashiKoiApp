/* admin.merch.js — 周邊（實體商品）品項 + 訂單管理 */
(function () {
  const ORDER_STATUS = {
    pending_payment: "待付款",
    paid: "已付款(待出貨)",
    shipped: "已出貨",
    done: "完成",
    cancelled: "取消"
  };
  function auth() { return { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` }; }
  function jsonH() { return { ...auth(), "Content-Type": "application/json" }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function taipeiTime(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/\//g, "-");
    } catch (e) { return String(iso).slice(0, 16).replace("T", " "); }
  }
  function log(m) { window.logActivity && window.logActivity(m); }

  let items = [], orders = [], orderFilter = "";

  // ───────── 品項 ─────────
  async function loadItems() {
    const r = await fetch("/admin/merch/items", { headers: auth() });
    const j = await r.json();
    if (j.status === "ok") { items = j.data.items || []; renderItems(); }
    else log("❌ 載入周邊品項失敗：" + (j.message || ""));
  }
  const ICOLS = [
    ["img", "圖片", "70px"], ["name", "名稱", "160px"], ["desc", "說明", "220px"],
    ["priceTwd", "現金價NT$", "90px"], ["priceDiamond", "鑽石價", "80px"],
    ["stock", "庫存(-1無限)", "90px"], ["maxPerOrder", "每筆上限", "80px"],
    ["sortOrder", "排序", "60px"], ["enabled", "上架", "50px"], ["actions", "操作", "120px"]
  ];
  function itemRow(it) {
    const isNew = !it.id;
    const img = it.imageUrl ? `<img src="${esc(it.imageUrl)}" style="height:40px;width:40px;object-fit:cover;border-radius:5px;">` : "—";
    const cell = {
      img: `<td style="text-align:center;">
        <div class="merch-img-preview" style="height:40px;">${img}</div>
        <label class="button small" style="font-size:10px;cursor:pointer;display:inline-block;margin-top:2px;">📤上傳<input type="file" accept="image/*" class="merch-img-file" style="display:none;"></label>
        <input class="sheet-input" data-f="imageUrl" placeholder="或貼圖片URL" value="${esc(it.imageUrl || "")}" style="width:70px;font-size:10px;margin-top:2px;">
      </td>`,
      name: `<td><input class="sheet-input" data-f="name" value="${esc(it.name || "")}" style="width:100%;"></td>`,
      desc: `<td><textarea class="sheet-input" data-f="description" rows="2" style="width:100%;">${esc(it.description || "")}</textarea></td>`,
      priceTwd: `<td><input class="sheet-input" data-f="priceTwd" type="number" min="0" value="${esc(String(it.priceTwd ?? 0))}" style="width:100%;text-align:right;"></td>`,
      priceDiamond: `<td><input class="sheet-input" data-f="priceDiamond" type="number" min="0" value="${esc(String(it.priceDiamond ?? 0))}" style="width:100%;text-align:right;"></td>`,
      stock: `<td><input class="sheet-input" data-f="stock" type="number" value="${esc(String(it.stock ?? -1))}" style="width:100%;text-align:right;"></td>`,
      maxPerOrder: `<td><input class="sheet-input" data-f="maxPerOrder" type="number" min="1" value="${esc(String(it.maxPerOrder ?? 1))}" style="width:100%;text-align:right;"></td>`,
      sortOrder: `<td><input class="sheet-input" data-f="sortOrder" type="number" value="${esc(String(it.sortOrder ?? 0))}" style="width:100%;text-align:right;"></td>`,
      enabled: `<td style="text-align:center;"><input type="checkbox" data-f="enabled" ${it.enabled !== false ? "checked" : ""}></td>`,
      actions: `<td style="white-space:nowrap;"><button class="button small merch-item-save">儲存</button>${isNew ? "" : `<button class="button small danger merch-item-del">刪除</button>`}</td>`
    };
    return `<tr data-id="${esc(it.id || "__new__")}">${ICOLS.map(c => cell[c[0]]).join("")}</tr>`;
  }
  function renderItems() {
    const head = document.getElementById("merch-item-head");
    const body = document.getElementById("merch-item-tbody");
    if (!body) return;
    head.innerHTML = `<tr>${ICOLS.map(c => `<th style="min-width:${c[2]};">${c[1]}</th>`).join("")}</tr>`;
    body.innerHTML = items.map(itemRow).join("") || `<tr><td colspan="${ICOLS.length}" style="text-align:center;color:var(--muted);padding:16px;">尚無周邊，點右上「＋ 新增周邊」</td></tr>`;
    bindItemRows(body);
  }
  function collectItem(tr) {
    const g = f => tr.querySelector(`[data-f="${f}"]`);
    return {
      name: g("name").value, description: g("description").value, imageUrl: g("imageUrl").value.trim() || null,
      priceTwd: Number(g("priceTwd").value) || 0, priceDiamond: Number(g("priceDiamond").value) || 0,
      stock: Number(g("stock").value), maxPerOrder: Number(g("maxPerOrder").value) || 1,
      sortOrder: Number(g("sortOrder").value) || 0, enabled: g("enabled").checked
    };
  }
  function bindItemRows(body) {
    body.querySelectorAll(".merch-img-file").forEach(inp => inp.addEventListener("change", async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const tr = inp.closest("tr");
      const preview = tr.querySelector(".merch-img-preview");
      preview.innerHTML = "上傳中…";
      try {
        const fd = new FormData(); fd.append("image", file);
        const r = await fetch("/admin/merch/upload-image", { method: "POST", headers: auth(), body: fd });
        const j = await r.json();
        if (j.status === "ok") {
          tr.querySelector('[data-f="imageUrl"]').value = j.data.imageUrl;
          preview.innerHTML = `<img src="${esc(j.data.imageUrl)}" style="height:40px;width:40px;object-fit:cover;border-radius:5px;">`;
          log("🖼 圖片已上傳（記得按「儲存」套用）");
        } else { preview.innerHTML = "—"; alert("❌ 上傳失敗：" + (j.message || "")); }
      } catch (e) { preview.innerHTML = "—"; alert("❌ 上傳失敗"); }
      inp.value = "";
    }));
    body.querySelectorAll(".merch-item-save").forEach(btn => btn.addEventListener("click", async () => {
      const tr = btn.closest("tr"); const id = tr.dataset.id; const isNew = id === "__new__";
      const payload = collectItem(tr);
      const r = await fetch(isNew ? "/admin/merch/items" : `/admin/merch/items/${id}`, { method: isNew ? "POST" : "PUT", headers: jsonH(), body: JSON.stringify(payload) });
      const j = await r.json();
      if (j.status === "ok") { log("✅ 周邊已儲存：" + payload.name); loadItems(); }
      else alert("❌ " + (j.message || "儲存失敗"));
    }));
    body.querySelectorAll(".merch-item-del").forEach(btn => btn.addEventListener("click", async () => {
      const tr = btn.closest("tr"); const id = tr.dataset.id;
      if (!confirm("確定刪除此周邊品項？")) return;
      const r = await fetch(`/admin/merch/items/${id}`, { method: "DELETE", headers: auth() });
      const j = await r.json();
      if (j.status === "ok") { log("🗑 已刪除周邊"); loadItems(); } else alert("❌ " + (j.message || "刪除失敗"));
    }));
  }

  // ───────── 訂單 ─────────
  async function loadOrders() {
    const q = orderFilter ? `?status=${encodeURIComponent(orderFilter)}` : "";
    const r = await fetch(`/admin/merch/orders${q}`, { headers: auth() });
    const j = await r.json();
    if (j.status === "ok") { orders = j.data.orders || []; renderOrders(); }
    else log("❌ 載入訂單失敗：" + (j.message || ""));
  }
  const OCOLS = ["訂單編號", "狀態", "付款", "商品", "數量", "金額", "收件人", "手機", "Email", "地址", "備註", "單號", "時間", "操作"];
  function renderOrders() {
    const head = document.getElementById("merch-order-head");
    const body = document.getElementById("merch-order-tbody");
    if (!body) return;
    head.innerHTML = `<tr>${OCOLS.map(c => `<th>${c}</th>`).join("")}</tr>`;
    body.innerHTML = orders.map(o => {
      const s = o.shipping || {};
      const statusSel = `<select class="sheet-input merch-ord-status" style="width:110px;">${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
      return `<tr data-no="${esc(o.orderNo)}">
        <td style="font-family:monospace;font-size:11px;">${esc(o.orderNo)}</td>
        <td>${statusSel}</td>
        <td>${o.payMethod === "diamond" ? "💎鑽石" : "💵現金"}${o.isGuest ? '<br><span style="font-size:10px;color:#ff9ec4;">🌐訪客</span>' : '<br><span style="font-size:10px;color:#7ce0ff;">🎮遊戲</span>'}</td>
        <td>${esc(o.itemName)}</td>
        <td style="text-align:center;">${o.qty}</td>
        <td style="text-align:right;">${o.payMethod === "diamond" ? o.amount + "💎" : "NT$" + o.amount}</td>
        <td>${esc(s.name)}</td>
        <td>${esc(s.phone)}</td>
        <td style="font-size:11px;">${esc(s.email)}</td>
        <td style="font-size:11px;">${esc(s.zip)} ${esc(s.address)}</td>
        <td style="font-size:11px;">${esc(s.note)}</td>
        <td><input class="sheet-input merch-ord-track" value="${esc(o.trackingNo || "")}" placeholder="物流單號" style="width:100px;"></td>
        <td style="font-size:10px;color:var(--muted);white-space:nowrap;">${esc(taipeiTime(o.createdAt))}</td>
        <td><button class="button small merch-ord-save">儲存</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="${OCOLS.length}" style="text-align:center;color:var(--muted);padding:16px;">尚無訂單</td></tr>`;
    body.querySelectorAll(".merch-ord-save").forEach(btn => btn.addEventListener("click", async () => {
      const tr = btn.closest("tr"); const no = tr.dataset.no;
      const status = tr.querySelector(".merch-ord-status").value;
      const trackingNo = tr.querySelector(".merch-ord-track").value;
      const r = await fetch(`/admin/merch/orders/${no}`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ status, trackingNo }) });
      const j = await r.json();
      if (j.status === "ok") { log("✅ 訂單已更新 " + no); loadOrders(); } else alert("❌ " + (j.message || "更新失敗"));
    }));
  }
  async function exportCsv() {
    const q = orderFilter ? `?status=${encodeURIComponent(orderFilter)}` : "";
    const r = await fetch(`/admin/merch/orders.csv${q}`, { headers: auth() });
    if (!r.ok) { alert("匯出失敗"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `merch-orders-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function initOnce() {
    const newBtn = document.getElementById("merch-item-new");
    if (newBtn && !newBtn._bound) {
      newBtn._bound = true;
      newBtn.addEventListener("click", () => {
        const body = document.getElementById("merch-item-tbody");
        const tmp = document.createElement("tbody");
        tmp.innerHTML = itemRow({ stock: -1, maxPerOrder: 1, enabled: true, priceDiamond: 0, priceTwd: 0 });
        body.prepend(tmp.firstElementChild);
        bindItemRows(body);
      });
    }
    const flt = document.getElementById("merch-order-filter");
    if (flt && !flt._bound) { flt._bound = true; flt.addEventListener("change", () => { orderFilter = flt.value; loadOrders(); }); }
    const rf = document.getElementById("merch-order-refresh");
    if (rf && !rf._bound) { rf._bound = true; rf.addEventListener("click", loadOrders); }
    const csv = document.getElementById("merch-order-csv");
    if (csv && !csv._bound) { csv._bound = true; csv.addEventListener("click", e => { e.preventDefault(); exportCsv(); }); }
  }

  window.loadMerchAdmin = function () { initOnce(); loadItems(); loadOrders(); };
  // 切到「周邊商城」分頁時載入
  document.addEventListener("click", (e) => {
    const nav = e.target.closest('[data-target="section-merch"]');
    if (nav) setTimeout(() => window.loadMerchAdmin(), 50);
  });
})();
