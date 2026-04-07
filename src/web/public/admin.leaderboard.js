/* admin.leaderboard.js — 排行榜分頁邏輯 */
(function () {
  const { request, log, escapeHtml } = window.adminCore;

  let lbData = null;     // { gold: [], level: [], checkin: [] }
  let activeTab = "gold";

  const MEDAL = ["🥇", "🥈", "🥉"];

  function renderTable(rows, columns) {
    if (!rows || !rows.length) {
      return '<p class="hint">目前沒有資料。</p>';
    }
    const thead = `<thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>`;
    const tbody = rows
      .map((row, i) => {
        const medal = MEDAL[i] || `${i + 1}`;
        const cells = columns.map((c) => {
          if (c.key === "__rank") return `<td>${medal}</td>`;
          const val = row[c.key];
          return `<td>${escapeHtml(val !== undefined ? String(val) : "—")}</td>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      })
      .join("");
    return `<div style="overflow-x:auto"><table class="shop-table" style="min-width:480px">${thead}<tbody>${tbody}</tbody></table></div>`;
  }

  function render() {
    const container = document.getElementById("leaderboard-content");
    if (!container) return;
    if (!lbData) {
      container.innerHTML = '<p class="hint">請先登入 API 後點「重新載入」。</p>';
      return;
    }

    if (activeTab === "gold") {
      container.innerHTML = renderTable(lbData.gold, [
        { key: "__rank", label: "名次" },
        { key: "displayName", label: "玩家名稱" },
        { key: "gold", label: "💰 金幣" },
        { key: "diamond", label: "💎 鑽石" },
        { key: "level", label: "等級" }
      ]);
    } else if (activeTab === "level") {
      container.innerHTML = renderTable(lbData.level, [
        { key: "__rank", label: "名次" },
        { key: "displayName", label: "玩家名稱" },
        { key: "level", label: "⭐ 等級" },
        { key: "exp", label: "EXP" },
        { key: "gold", label: "💰 金幣" }
      ]);
    } else if (activeTab === "checkin") {
      container.innerHTML = renderTable(lbData.checkin, [
        { key: "__rank", label: "名次" },
        { key: "displayName", label: "玩家名稱" },
        { key: "checkinCount", label: "📅 打卡次數" },
        { key: "level", label: "等級" },
        { key: "gold", label: "💰 金幣" }
      ]);
    }
  }

  async function loadLeaderboard() {
    const container = document.getElementById("leaderboard-content");
    if (container) container.innerHTML = '<p class="hint">載入中...</p>';
    try {
      lbData = await request("/admin/console/leaderboard?limit=20");
      render();
      log("排行榜資料已更新");
    } catch (e) {
      if (container) container.innerHTML = `<p class="hint" style="color:var(--color-error)">載入失敗：${e.message}</p>`;
      log(`排行榜載入失敗：${e.message}`);
    }
  }

  function init() {
    // Tab 切換
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".leaderboard-tab-btn");
      if (!btn) return;
      document.querySelectorAll(".leaderboard-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.lbTab;
      render();
    });

    // 重新載入按鈕
    document.getElementById("leaderboard-refresh")?.addEventListener("click", loadLeaderboard);

    // 切換到排行榜分頁時自動載入（如果還沒載入）
    document.addEventListener("click", (e) => {
      const navBtn = e.target.closest(".nav-link");
      if (navBtn && navBtn.dataset.target === "section-leaderboard" && !lbData) {
        loadLeaderboard();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
