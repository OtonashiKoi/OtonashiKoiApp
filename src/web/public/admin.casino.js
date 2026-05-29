(function () {
  const COLOR_EMOJI = { yellow: "🟡", green: "🟢", red: "🔴", blue: "🔵", purple: "🟣" };

  const refreshBtn = document.getElementById("casino-refresh-btn");
  const toggleBtn  = document.getElementById("casino-toggle-btn");
  const publishBtn = document.getElementById("casino-publish-btn");
  const publishCh  = document.getElementById("casino-publish-channel");
  const enabledEl  = document.getElementById("casino-enabled-flag");
  const channelEl  = document.getElementById("casino-channel-id");
  const messageEl  = document.getElementById("casino-message-id");
  const roundIdEl  = document.getElementById("casino-round-id");
  const roundStEl  = document.getElementById("casino-round-status");
  const roundPotEl = document.getElementById("casino-round-pot");
  const recentEl   = document.getElementById("casino-recent-results");
  const dailyRoundsEl = document.getElementById("casino-daily-rounds");
  const dailyBetEl    = document.getElementById("casino-daily-bet");
  const dailyPayEl    = document.getElementById("casino-daily-payout");
  const dailyProfitEl = document.getElementById("casino-daily-profit");

  let currentEnabled = true;
  let currentChannelId = "";
  let currentMessageId = "";

  function headers() {
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (window.getAdminToken ? window.getAdminToken() : ""),
    };
  }

  async function fetchJSON(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  }

  function fmt(n) { return Number(n || 0).toLocaleString("zh-TW"); }

  async function refresh() {
    try {
      const layoutRes = await fetchJSON("/admin/channel-layout", { headers: headers() });
      const binding = (layoutRes?.data?.layout?.discord?.bindings || []).find((b) => b.featureKey === "casino_wheel");
      currentEnabled = binding ? binding.enabled !== false : true;
      currentChannelId = binding?.channelId || "";
      currentMessageId = binding?.panelMessageId || "";

      const statusRes = await fetchJSON("/admin/casino/status", { headers: headers() });
      const data = statusRes?.data || {};
      const round = data.currentRound;
      const recent = data.recentResults || [];
      const daily = data.daily || {};

      enabledEl.textContent = currentEnabled ? "✅ 已啟用" : "⏸ 已停用";
      channelEl.textContent = currentChannelId || "—（尚未綁定）";
      messageEl.textContent = currentMessageId || "—";

      if (round) {
        roundIdEl.textContent = `#${round.roundId}`;
        const statusLabel = round.status === "open" ? "🟢 下注中"
          : round.status === "locked" ? "🔒 鎖盤" : "⚙️ 結算中";
        roundStEl.textContent = statusLabel;
        const pot = ["yellow", "green", "red", "blue", "purple"]
          .reduce((a, c) => a + (round.totals?.[c] || 0), 0);
        roundPotEl.textContent = `${fmt(pot)} 金幣`;
      } else {
        roundIdEl.textContent = "—";
        roundStEl.textContent = "—";
        roundPotEl.textContent = "—";
      }
      recentEl.textContent = recent.length
        ? recent.slice(-8).map((r) => `${COLOR_EMOJI[r.color] || "⚪"}×${r.mult}`).join(" ")
        : "—";

      dailyRoundsEl.textContent = fmt(daily.rounds);
      dailyBetEl.textContent    = `${fmt(daily.totalBet)} 金幣`;
      dailyPayEl.textContent    = `${fmt(daily.totalPayout)} 金幣`;
      dailyProfitEl.textContent = `${fmt(daily.houseProfit)} 金幣`;

      toggleBtn.textContent = currentEnabled ? "⏸ 停用賭場" : "▶ 啟用賭場";
      toggleBtn.disabled = false;
      publishCh.value = publishCh.value || currentChannelId || "";
    } catch (err) {
      console.error("[casino-admin]", err);
      enabledEl.textContent = `載入失敗：${err.message}`;
    }
  }

  async function onToggle() {
    toggleBtn.disabled = true;
    try {
      await fetchJSON("/admin/casino/enabled", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      await refresh();
    } catch (err) {
      alert("切換失敗：" + err.message);
      toggleBtn.disabled = false;
    }
  }

  async function onPublish() {
    const channelId = (publishCh.value || "").trim();
    if (!channelId) { alert("請先輸入頻道 ID"); return; }
    publishBtn.disabled = true;
    publishBtn.textContent = "發布中…";
    try {
      const r = await fetchJSON("/admin/channel-layout/publish-casino", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ channelId }),
      });
      alert(`✅ 已發布面板\n頻道：${r?.data?.channelId}\n訊息：${r?.data?.messageId}`);
      await refresh();
    } catch (err) {
      alert("發布失敗：" + err.message);
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "📨 發布／重發面板";
    }
  }

  refreshBtn?.addEventListener("click", refresh);
  toggleBtn?.addEventListener("click", onToggle);
  publishBtn?.addEventListener("click", onPublish);

  // 進入 section 時自動刷新一次
  document.addEventListener("click", (e) => {
    const tg = e.target.closest('[data-target="section-casino"]');
    if (tg) setTimeout(refresh, 50);
  });

  // 全域曝光供其他模組呼叫
  window.refreshCasinoAdmin = refresh;
})();
