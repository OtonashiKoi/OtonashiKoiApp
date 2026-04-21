/* admin.auction.js — 拍賣場後台管理 */
(function () {
  const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];

  let auctions = [];
  let channels = [];
  let currentSettings = { channelId: null, enabled: true, sellerTiers: ["C", "B", "A", "S", "SS"] };

  function auth() { return { Authorization: `Bearer ${window.getAdminToken ? window.getAdminToken() : ""}` }; }
  function jsonH() { return { "Content-Type": "application/json", ...auth() }; }

  // ── 初始化按鈕事件 ───────────────────────────────────
  function init() {
    document.getElementById("auction-refresh-btn")?.addEventListener("click", loadAuctions);
    document.getElementById("auction-filter-status")?.addEventListener("change", loadAuctions);
    document.getElementById("auction-save-settings-btn")?.addEventListener("click", saveSettings);
    document.getElementById("auction-save-channel-btn")?.addEventListener("click", saveSettings);
    document.getElementById("auction-publish-btn")?.addEventListener("click", publishPanel);
    document.getElementById("auction-toggle-btn")?.addEventListener("click", toggleEnabled);
  }

  // ── 連線後載入 ───────────────────────────────────────
  async function load(bootstrapData) {
    channels = bootstrapData?.discord?.channels || [];
    populateChannelSelect();
    await loadSettings();
    await loadAuctions();
  }

  function populateChannelSelect() {
    const sel = document.getElementById("auction-channel-select");
    if (!sel) return;
    sel.innerHTML = '<option value="">── 選擇文字頻道 ──</option>';
    channels
      .filter(c => c.type === 0)
      .forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `#${c.name}`;
        sel.appendChild(opt);
      });
    if (currentSettings.channelId) sel.value = currentSettings.channelId;
  }

  async function loadSettings() {
    try {
      const res = await fetch("/admin/auction/config", { headers: auth() });
      const json = await res.json();
      if (json.status === "ok") {
        currentSettings = {
          channelId: null,
          enabled: true,
          sellerTiers: ["C", "B", "A", "S", "SS"],
          ...json.data
        };
        applySettingsToUI();
      }
    } catch (_) {}
  }

  function applySettingsToUI() {
    // 頻道
    const sel = document.getElementById("auction-channel-select");
    if (sel && currentSettings.channelId) sel.value = currentSettings.channelId;

    // 開關
    updateToggleBtn(currentSettings.enabled);

    // Tier 勾選
    TIER_RANKS.forEach(tier => {
      const cb = document.getElementById(`auction-tier-${tier}`);
      if (cb) cb.checked = (currentSettings.sellerTiers || []).includes(tier);
    });

    setSettingsStatus(currentSettings.enabled
      ? `✅ 拍賣場目前：開啟　上架資格：${(currentSettings.sellerTiers || []).join("、") || "無"}`
      : `🔴 拍賣場目前：關閉`
    );
  }

  function updateToggleBtn(enabled) {
    const btn = document.getElementById("auction-toggle-btn");
    if (!btn) return;
    btn.textContent = enabled ? "🔴 關閉拍賣場" : "🟢 開啟拍賣場";
    btn.style.background = enabled ? "#dc2626" : "#16a34a";
  }

  async function toggleEnabled() {
    const next = !currentSettings.enabled;
    if (!confirm(next ? "確定要開啟拍賣場嗎？" : "確定要關閉拍賣場嗎？關閉後玩家無法上架或購買。")) return;
    try {
      const res = await fetch("/admin/auction/config", {
        method: "PUT", headers: jsonH(),
        body: JSON.stringify({ enabled: next })
      });
      const json = await res.json();
      if (json.status === "ok") {
        currentSettings.enabled = next;
        updateToggleBtn(next);
        setSettingsStatus(next ? "✅ 拍賣場已開啟" : "🔴 拍賣場已關閉");
        window.logActivity?.(`${next ? "✅ 開啟" : "🔴 關閉"} 拍賣場`);
      }
    } catch (e) {
      setSettingsStatus("❌ 操作失敗：" + e.message);
    }
  }

  async function saveSettings() {
    const channelId = document.getElementById("auction-channel-select")?.value || null;
    const sellerTiers = TIER_RANKS.filter(tier => document.getElementById(`auction-tier-${tier}`)?.checked);

    try {
      const res = await fetch("/admin/auction/config", {
        method: "PUT", headers: jsonH(),
        body: JSON.stringify({ channelId, sellerTiers })
      });
      const json = await res.json();
      if (json.status === "ok") {
        currentSettings = { ...currentSettings, channelId, sellerTiers };
        setSettingsStatus(`✅ 已儲存　上架資格：${sellerTiers.join("、") || "無"}`);
        window.logActivity?.(`✅ 拍賣場設定已更新，上架 Tier：${sellerTiers.join(",")}，頻道：${channelId}`);
      } else {
        setSettingsStatus("❌ 儲存失敗：" + (json.message || ""));
      }
    } catch (e) {
      setSettingsStatus("❌ 儲存失敗：" + e.message);
    }
  }

  async function publishPanel() {
    const channelId = document.getElementById("auction-channel-select")?.value || currentSettings.channelId;
    if (!channelId) { alert("請先選擇頻道。"); return; }
    if (!confirm(`確定要在頻道 ${channelId} 發布拍賣場面板嗎？`)) return;
    try {
      const res = await fetch("/admin/auction/publish", {
        method: "POST", headers: jsonH(),
        body: JSON.stringify({ channelId })
      });
      const json = await res.json();
      if (json.status === "ok") {
        setSettingsStatus("✅ 面板已發布！");
        window.logActivity?.("✅ 拍賣場面板已發布");
      } else {
        setSettingsStatus("❌ 發布失敗：" + (json.message || ""));
      }
    } catch (e) {
      setSettingsStatus("❌ 發布失敗：" + e.message);
    }
  }

  // ── 拍賣列表 ─────────────────────────────────────────
  async function loadAuctions() {
    const status = document.getElementById("auction-filter-status")?.value || "";
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (status) params.set("status", status);
      const res = await fetch(`/admin/auction/list?${params}`, { headers: auth() });
      const json = await res.json();
      if (json.status === "ok") {
        auctions = json.data?.items || [];
        const label = document.getElementById("auction-count-label");
        if (label) label.textContent = `共 ${json.data?.total || 0} 筆`;
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
      active:    '<span style="color:#16a34a;font-weight:600;">● 上架中</span>',
      sold:      '<span style="color:#2563eb;font-weight:600;">✔ 已售出</span>',
      expired:   '<span style="color:#d97706;font-weight:600;">⏰ 已到期</span>',
      reclaimed: '<span style="color:#6b7280;">↩ 已領回</span>',
      removed:   '<span style="color:#dc2626;">✕ 已強制下架</span>',
    };

    const rows = auctions.map(a => {
      const item = a.item || {};
      const enh = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : "";
      const stack = item.isGem && item.stackCount ? ` ×${item.stackCount}` : "";
      const itemLabel = `${item.itemName || "?"}${enh}${stack}`;
      const priceLabel = a.currency === "gold"
        ? `${(a.price || 0).toLocaleString()} 💰`
        : `${(a.price || 0).toLocaleString()} 💎`;
      const expiresLabel = a.expiresAt
        ? new Date(a.expiresAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
        : "─";
      const statusHtml = STATUS_LABELS[a.status] || a.status;
      const canRemove = a.status === "active" || a.status === "expired";

      return `<tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:.5rem .75rem;font-size:.85rem;max-width:200px;word-break:break-all;">${esc(itemLabel)}</td>
        <td style="padding:.5rem .75rem;font-size:.85rem;">${esc(priceLabel)}</td>
        <td style="padding:.5rem .75rem;font-size:.8rem;color:#6b7280;max-width:160px;word-break:break-all;">${esc(a.sellerId || "─")}</td>
        <td style="padding:.5rem .75rem;font-size:.85rem;">${statusHtml}</td>
        <td style="padding:.5rem .75rem;font-size:.8rem;color:#9ca3af;white-space:nowrap;">${esc(expiresLabel)}</td>
        <td style="padding:.5rem .75rem;">
          ${canRemove ? `<button onclick="window.__auctionAdmin.forceRemove('${a.id}')"
            style="padding:.3rem .6rem;background:#dc2626;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:.8rem;">
            強制下架</button>` : ""}
        </td>
      </tr>`;
    }).join("");

    container.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
        <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">商品</th>
        <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">定價</th>
        <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">賣家 ID</th>
        <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">狀態</th>
        <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">到期時間</th>
        <th style="padding:.5rem .75rem;text-align:left;font-size:.8rem;color:#6b7280;">操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  async function forceRemove(auctionId) {
    if (!confirm("確定要強制下架這件商品嗎？物品會退回賣家背包。")) return;
    try {
      const res = await fetch(`/admin/auction/${auctionId}`, { method: "DELETE", headers: auth() });
      const json = await res.json();
      if (json.status === "ok") {
        window.logActivity?.(`✅ 已強制下架拍賣 ${auctionId}`);
        await loadAuctions();
      } else {
        alert("❌ 下架失敗：" + (json.message || "未知錯誤"));
      }
    } catch (e) {
      alert("❌ 下架失敗：" + e.message);
    }
  }

  function setSettingsStatus(msg) {
    const settingEl = document.getElementById("auction-settings-status");
    if (settingEl) settingEl.textContent = msg;
    const channelEl = document.getElementById("auction-channel-status");
    if (channelEl) channelEl.textContent = msg;
  }

  function setContainerMsg(msg) {
    const el = document.getElementById("auction-list-container");
    if (el) el.innerHTML = `<p style="color:#9ca3af;">${esc(msg)}</p>`;
  }

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.__auctionAdmin = { load, forceRemove };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
