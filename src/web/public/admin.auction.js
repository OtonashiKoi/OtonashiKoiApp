/* admin.auction.js — 拍賣場後台管理 */
(function () {
  let auctions = [];
  let channels = [];
  let currentChannelId = null;

  function auth() { return { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` }; }
  function jsonH() { return { "Content-Type": "application/json", ...auth() }; }

  // ── 初始化 ──────────────────────────────────────────
  function init() {
    const refreshBtn = document.getElementById("auction-refresh-btn");
    const filterStatus = document.getElementById("auction-filter-status");
    const saveChannelBtn = document.getElementById("auction-save-channel-btn");
    const publishBtn = document.getElementById("auction-publish-btn");

    if (refreshBtn) refreshBtn.addEventListener("click", loadAuctions);
    if (filterStatus) filterStatus.addEventListener("change", loadAuctions);
    if (saveChannelBtn) saveChannelBtn.addEventListener("click", saveChannel);
    if (publishBtn) publishBtn.addEventListener("click", publishPanel);
  }

  // ── 載入（連線後觸發）────────────────────────────────
  async function load(bootstrapData) {
    channels = bootstrapData?.discord?.channels || [];
    populateChannelSelect();
    await loadChannelConfig();
    await loadAuctions();
  }

  function populateChannelSelect() {
    const sel = document.getElementById("auction-channel-select");
    if (!sel) return;
    sel.innerHTML = '<option value="">── 選擇文字頻道 ──</option>';
    channels
      .filter(c => c.type === 0) // 0 = GUILD_TEXT
      .forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `#${c.name}`;
        sel.appendChild(opt);
      });
    if (currentChannelId) sel.value = currentChannelId;
  }

  async function loadChannelConfig() {
    try {
      const res = await fetch("/admin/auction/config", { headers: auth() });
      const json = await res.json();
      if (json.status === "ok" && json.data?.channelId) {
        currentChannelId = json.data.channelId;
        const sel = document.getElementById("auction-channel-select");
        if (sel) sel.value = currentChannelId;
        setChannelStatus(`目前設定頻道 ID：${currentChannelId}`);
      }
    } catch (_) {}
  }

  async function loadAuctions() {
    const status = document.getElementById("auction-filter-status")?.value || "";
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (status) params.set("status", status);
      const res = await fetch(`/admin/auction/list?${params}`, { headers: auth() });
      const json = await res.json();
      if (json.status === "ok") {
        auctions = json.data?.items || [];
        const total = json.data?.total || 0;
        const label = document.getElementById("auction-count-label");
        if (label) label.textContent = `共 ${total} 筆`;
        renderAuctions();
      }
    } catch (e) {
      setContainerMsg("❌ 載入失敗：" + e.message);
    }
  }

  function renderAuctions() {
    const container = document.getElementById("auction-list-container");
    if (!container) return;
    if (!auctions.length) {
      container.innerHTML = '<p style="color:#9ca3af;">目前無拍賣資料。</p>';
      return;
    }

    const STATUS_LABELS = {
      active: '<span style="color:#16a34a;">● 上架中</span>',
      sold: '<span style="color:#2563eb;">✔ 已售出</span>',
      expired: '<span style="color:#d97706;">⏰ 已到期</span>',
      reclaimed: '<span style="color:#6b7280;">↩ 已領回</span>',
      removed: '<span style="color:#dc2626;">✕ 已強制下架</span>',
    };

    const rows = auctions.map(a => {
      const item = a.item || {};
      const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
      const stack = item.isGem && item.stackCount ? ` ×${item.stackCount}` : "";
      const itemLabel = `${item.itemName || "?"}${enh}${stack}`;
      const priceLabel = a.currency === "gold"
        ? `${(a.price || 0).toLocaleString()} 💰`
        : `${(a.price || 0).toLocaleString()} 💎`;
      const expiresLabel = a.expiresAt ? new Date(a.expiresAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "─";
      const statusHtml = STATUS_LABELS[a.status] || a.status;
      const canRemove = a.status === "active" || a.status === "expired";

      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:.5rem .75rem;font-size:.85rem;color:#374151;max-width:200px;word-break:break-all;">${esc(itemLabel)}</td>
          <td style="padding:.5rem .75rem;font-size:.85rem;">${esc(priceLabel)}</td>
          <td style="padding:.5rem .75rem;font-size:.85rem;color:#6b7280;">${esc(a.sellerId || "─")}</td>
          <td style="padding:.5rem .75rem;font-size:.85rem;">${statusHtml}</td>
          <td style="padding:.5rem .75rem;font-size:.8rem;color:#9ca3af;">${esc(expiresLabel)}</td>
          <td style="padding:.5rem .75rem;">
            ${canRemove ? `<button onclick="window.__auctionAdmin.forceRemove('${a.id}')" style="padding:.3rem .6rem;background:#dc2626;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:.8rem;">強制下架</button>` : ""}
          </td>
        </tr>`;
    }).join("");

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
            <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">商品</th>
            <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">定價</th>
            <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">賣家 ID</th>
            <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">狀態</th>
            <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">到期時間</th>
            <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function forceRemove(auctionId) {
    if (!confirm("確定要強制下架這件商品嗎？物品會退回賣家背包。")) return;
    try {
      const res = await fetch(`/admin/auction/${auctionId}`, { method: "DELETE", headers: auth() });
      const json = await res.json();
      if (json.status === "ok") {
        window.logActivity && window.logActivity(`✅ 已強制下架拍賣 ${auctionId}`);
        await loadAuctions();
      } else {
        alert("❌ 下架失敗：" + (json.message || "未知錯誤"));
      }
    } catch (e) {
      alert("❌ 下架失敗：" + e.message);
    }
  }

  async function saveChannel() {
    const sel = document.getElementById("auction-channel-select");
    const channelId = sel?.value;
    if (!channelId) { alert("請先選擇頻道。"); return; }
    try {
      const res = await fetch("/admin/auction/config", {
        method: "PUT",
        headers: jsonH(),
        body: JSON.stringify({ channelId })
      });
      const json = await res.json();
      if (json.status === "ok") {
        currentChannelId = channelId;
        setChannelStatus(`✅ 已儲存頻道 ID：${channelId}`);
        window.logActivity && window.logActivity(`✅ 拍賣場頻道已設定為 ${channelId}`);
      } else {
        setChannelStatus("❌ 儲存失敗：" + (json.message || ""));
      }
    } catch (e) {
      setChannelStatus("❌ 儲存失敗：" + e.message);
    }
  }

  async function publishPanel() {
    const channelId = currentChannelId || document.getElementById("auction-channel-select")?.value;
    if (!channelId) { alert("請先儲存頻道設定。"); return; }
    if (!confirm(`確定要在頻道 ${channelId} 發布拍賣場面板嗎？`)) return;
    try {
      const res = await fetch("/admin/auction/publish", {
        method: "POST",
        headers: jsonH(),
        body: JSON.stringify({ channelId })
      });
      const json = await res.json();
      if (json.status === "ok") {
        setChannelStatus("✅ 面板已發布！");
        window.logActivity && window.logActivity("✅ 拍賣場面板已發布");
      } else {
        setChannelStatus("❌ 發布失敗：" + (json.message || ""));
      }
    } catch (e) {
      setChannelStatus("❌ 發布失敗：" + e.message);
    }
  }

  function setChannelStatus(msg) {
    const el = document.getElementById("auction-channel-status");
    if (el) el.textContent = msg;
  }

  function setContainerMsg(msg) {
    const el = document.getElementById("auction-list-container");
    if (el) el.innerHTML = `<p style="color:#9ca3af;">${esc(msg)}</p>`;
  }

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── 對外暴露 ─────────────────────────────────────────
  window.__auctionAdmin = { load, forceRemove };

  // 等 DOM 載入後初始化按鈕
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 連線後由 admin.core.js bootstrap 資料呼叫 load()
  const _origOnBootstrap = window.onAdminBootstrap;
  window.onAdminBootstrap = function (data) {
    if (_origOnBootstrap) _origOnBootstrap(data);
    load(data);
  };
})();
