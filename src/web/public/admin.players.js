/* admin.players.js - player list, detail and actions */
(function () {
  const { request, log, escapeHtml, formatDateTime, togglePlayerDetail, setPlayerActionEnabled, splitLines, showSection } = window.adminCore;
  const state = window.state;
  const elements = window.elements;

  function renderTransactions(items) {
    if (!items || items.length === 0) {
      elements.playerTransactionList.innerHTML = '<div class="transaction-row"><span>尚無交易</span><small>等待第一筆遊戲紀錄</small><span>-</span></div>';
      return;
    }

    elements.playerTransactionList.innerHTML = items
      .map((item) => {
        const sign = item.direction === "debit" ? "-" : "+";
        return `
        <div class="transaction-row ${escapeHtml(item.direction)}">
          <strong>${escapeHtml(item.currencyType)} ${sign}${Math.abs(item.amount)}</strong>
          <small>${escapeHtml(item.source)}<br>${escapeHtml(formatDateTime(item.createdAt || item.occurredAt))}</small>
          <span>餘額 ${escapeHtml(item.balanceAfter)}</span>
        </div>
      `;
      })
      .join("");
  }

  function renderPlayerDetail(data) {
    state.selectedPlayerData = data;
    togglePlayerDetail(true);
    setPlayerActionEnabled(true);

    elements.playerNameHeading.textContent = data.player.displayName || "unknown";
    elements.playerIdLine.textContent = `Discord ID: ${data.player.discordId}`;
    elements.playerStatusBadge.textContent = data.player.status || "unknown";
    elements.playerLevelValue.textContent = data.progress.level;
    elements.playerExpValue.textContent = data.progress.exp;
    const tierEl = document.getElementById("player-tier-value");
    if (tierEl) tierEl.textContent = data.progress.playerTier || "-";
    elements.playerGoldValue.textContent = data.wallet.gold;
    elements.playerDiamondValue.textContent = data.wallet.diamond;
    elements.playerCreatedAt.textContent = formatDateTime(data.player.createdAt);
    elements.playerUpdatedAt.textContent = formatDateTime(data.player.updatedAt);
    elements.playerWalletUpdatedAt.textContent = formatDateTime(data.wallet.updatedAt);
    elements.playerProgressUpdatedAt.textContent = formatDateTime(data.progress.updatedAt);
    renderTransactions(data.transactions);
  }

  function renderPlayerList() {
    elements.playerList.innerHTML = "";

    const keyword = state.playerSearchKeyword.trim().toLowerCase();
    const visiblePlayers = state.players.filter((player) => {
      if (!keyword) return true;
      return `${player.displayName || ""} ${player.discordId}`.toLowerCase().includes(keyword);
    });

    elements.playerListSummary.textContent = `共 ${state.players.length} 位玩家，目前顯示 ${visiblePlayers.length} 位`;

    if (visiblePlayers.length === 0) {
      elements.playerList.textContent = "目前還沒有玩家資料。";
      return;
    }

    for (const player of visiblePlayers) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "player-row";
      row.dataset.discordId = player.discordId;
      row.dataset.name = player.displayName || "-";
      if (player.discordId === state.selectedPlayerId) {
        row.classList.add("active");
      }
      const initial = escapeHtml((player.displayName || "?").trim().charAt(0).toUpperCase() || "?");
      row.innerHTML = `
      <span class="player-avatar">${initial}</span>
      <div class="player-meta"><strong>${escapeHtml(player.displayName || "unknown")}</strong><small>${escapeHtml(player.discordId)}</small></div>
    `;
      elements.playerList.appendChild(row);
    }
  }

  /* Resizable splitters for shell and player list are provided by admin.players.init.js */

  async function loadPlayers() {
    const rows = await request("/admin/console/players?limit=200");
    state.players = rows;

    if (!state.selectedPlayerId && rows.length > 0) {
      state.selectedPlayerId = rows[0].discordId;
    }

    renderPlayerList();

    if (state.selectedPlayerId) {
      await loadPlayerDetail(state.selectedPlayerId);
    } else {
      state.selectedPlayerData = null;
      togglePlayerDetail(false);
      setPlayerActionEnabled(false);
      elements.playerDetail.textContent = "請先建立玩家資料後再查看。";
    }

    log(`玩家列表載入完成，共 ${rows.length} 位玩家`);
  }

  function formatTransaction(item) {
    const sign = item.direction === "debit" ? "-" : "+";
    return `${item.currencyType} ${sign}${Math.abs(item.amount)} | ${item.source} | ${item.balanceAfter}`;
  }

  async function loadPlayerDetail(discordId) {
    const data = await request(`/admin/console/players/${encodeURIComponent(discordId)}`);
    state.selectedPlayerId = discordId;
    renderPlayerList();
    renderPlayerDetail(data);
  }

  async function saveAccessControl(url, body, successMessage) {
    const data = await request(url, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    const accessControl = data?.accessControl || data;
    const syncReport = data?.syncReport;

    state.accessControl = accessControl;
    if (window.adminBindings && typeof window.adminBindings.renderAccessControl === 'function') {
      window.adminBindings.renderAccessControl();
    }
    log(successMessage);

    if (syncReport) {
      log(
        `玩家資料同步：處理 ${syncReport.ensured} 人，新增玩家 ${syncReport.createdPlayers}、錢包 ${syncReport.createdWallets}、進度 ${syncReport.createdProgress}，略過 ${syncReport.skipped}（${syncReport.reason}）`
      );
    }
  }

  async function submitCurrencyAction() {
    if (!state.selectedPlayerData) {
      throw new Error("請先選擇一位玩家");
    }

    const rawAmount = Number(elements.currencyAmountInput.value);
    if (!Number.isInteger(rawAmount) || rawAmount <= 0) {
      throw new Error("資源數量必須是正整數");
    }

    const amount = elements.currencyOperationInput.value === "deduct" ? -rawAmount : rawAmount;
    const reason = elements.currencyReasonInput.value.trim() || "admin console currency adjustment";
    const player = state.selectedPlayerData.player;

    await request(`/admin/players/${encodeURIComponent(player.discordId)}/grant`, {
      method: "POST",
      body: JSON.stringify({
        displayName: player.displayName,
        currencyType: elements.currencyTypeInput.value,
        amount,
        reason,
        adminId: "admin-console"
      })
    });

    await loadPlayerDetail(player.discordId);
    log(`已對 ${player.displayName} ${amount > 0 ? "增加" : "扣除"} ${Math.abs(amount)} ${elements.currencyTypeInput.value}`);
  }

  async function submitExpAction() {
    if (!state.selectedPlayerData) {
      throw new Error("請先選擇一位玩家");
    }

    const amount = Number(elements.expAmountInput.value);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("經驗值必須是正整數");
    }

    const player = state.selectedPlayerData.player;
    const reason = elements.expReasonInput.value.trim() || "admin console exp adjustment";

    await request(`/admin/players/${encodeURIComponent(player.discordId)}/grant-exp`, {
      method: "POST",
      body: JSON.stringify({
        displayName: player.displayName,
        amount,
        reason,
        adminId: "admin-console"
      })
    });

    await loadPlayerDetail(player.discordId);
    log(`已對 ${player.displayName} 發放 ${amount} 經驗`);
  }

  // bindEvents and splitters moved to admin.players.init.js to keep file sizes small

  // expose players API used by bindings
  window.adminPlayers = {
    loadPlayers,
    renderPlayerList,
    loadPlayerDetail,
    saveAccessControl,
    submitCurrencyAction,
    submitExpAction
  };

  // initialize
  document.addEventListener('DOMContentLoaded', initSplitters);
  adminCore.loadAuth();
  bindEvents();
  setPlayerActionEnabled(false);
  showSection("section-auth");
})();
