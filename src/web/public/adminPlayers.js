// 玩家列表與詳細資料渲染、玩家操作（金幣/鑽石/經驗）
// ------------------------------------------------

function renderTransactions(items) {
  const list = document.getElementById("player-transaction-list");
  if (!items || items.length === 0) {
    list.innerHTML = '<div class="transaction-row"><span>尚無交易</span><small>等待第一筆遊戲紀錄</small><span>-</span></div>';
    return;
  }

  list.innerHTML = items
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

function setPlayerActionEnabled(enabled) {
  ["currency-type-input", "currency-operation-input", "currency-amount-input",
    "currency-reason-input", "currency-submit-button",
    "exp-amount-input", "exp-reason-input", "exp-submit-button"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

function togglePlayerDetail(hasSelection) {
  const playerDetail = document.getElementById("player-detail");
  const playerDetailView = document.getElementById("player-detail-view");
  if (playerDetail) playerDetail.classList.toggle("hidden", hasSelection);
  if (playerDetailView) playerDetailView.classList.toggle("hidden", !hasSelection);
}

function renderPlayerDetail(data, state) {
  state.selectedPlayerData = data;
  togglePlayerDetail(true);
  setPlayerActionEnabled(true);

  document.getElementById("player-name-heading").textContent = data.player.displayName || "unknown";
  document.getElementById("player-id-line").textContent = `Discord ID: ${data.player.discordId}`;
  document.getElementById("player-status-badge").textContent = data.player.status || "unknown";
  document.getElementById("player-level-value").textContent = data.progress.level;
  document.getElementById("player-exp-value").textContent = data.progress.exp;
  document.getElementById("player-gold-value").textContent = data.wallet.gold;
  document.getElementById("player-diamond-value").textContent = data.wallet.diamond;
  document.getElementById("player-created-at").textContent = formatDateTime(data.player.createdAt);
  document.getElementById("player-updated-at").textContent = formatDateTime(data.player.updatedAt);
  document.getElementById("player-wallet-updated-at").textContent = formatDateTime(data.wallet.updatedAt);
  document.getElementById("player-progress-updated-at").textContent = formatDateTime(data.progress.updatedAt);
  renderTransactions(data.transactions);
}

function renderPlayerList(state) {
  const playerList = document.getElementById("player-list");
  const playerListSummary = document.getElementById("player-list-summary");
  playerList.innerHTML = "";

  const keyword = state.playerSearchKeyword.trim().toLowerCase();
  const visiblePlayers = state.players.filter((player) => {
    if (!keyword) return true;
    return `${player.displayName || ""} ${player.discordId}`.toLowerCase().includes(keyword);
  });

  playerListSummary.textContent = `共 ${state.players.length} 位玩家，目前顯示 ${visiblePlayers.length} 位`;

  if (visiblePlayers.length === 0) {
    playerList.textContent = "目前還沒有玩家資料。";
    return;
  }

  for (const player of visiblePlayers) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "player-row";
    row.dataset.discordId = player.discordId;
    row.dataset.name = player.displayName || "-";
    if (player.discordId === state.selectedPlayerId) row.classList.add("active");
    const initial = escapeHtml((player.displayName || "?").trim().charAt(0).toUpperCase() || "?");
    row.innerHTML = `
      <span class="player-avatar">${initial}</span>
      <div class="player-meta"><strong>${escapeHtml(player.displayName || "unknown")}</strong><small>${escapeHtml(player.discordId)}</small></div>
    `;
    playerList.appendChild(row);
  }
}

async function loadPlayers(state) {
  const rows = await request("/admin/console/players?limit=200");
  state.players = rows;

  if (!state.selectedPlayerId && rows.length > 0) {
    state.selectedPlayerId = rows[0].discordId;
  }

  renderPlayerList(state);

  if (state.selectedPlayerId) {
    await loadPlayerDetail(state.selectedPlayerId, state);
  } else {
    state.selectedPlayerData = null;
    togglePlayerDetail(false);
    setPlayerActionEnabled(false);
    document.getElementById("player-detail").textContent = "請先建立玩家資料後再查看。";
  }

  log(`玩家列表載入完成，共 ${rows.length} 位玩家`);
}

async function loadPlayerDetail(discordId, state) {
  const data = await request(`/admin/console/players/${encodeURIComponent(discordId)}`);
  state.selectedPlayerId = discordId;
  renderPlayerList(state);
  renderPlayerDetail(data, state);
}

async function submitCurrencyAction(state) {
  if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");

  const rawAmount = Number(document.getElementById("currency-amount-input").value);
  if (!Number.isInteger(rawAmount) || rawAmount <= 0) throw new Error("資源數量必須是正整數");

  const operation = document.getElementById("currency-operation-input").value;
  const currencyType = document.getElementById("currency-type-input").value;
  const amount = operation === "deduct" ? -rawAmount : rawAmount;
  const reason = document.getElementById("currency-reason-input").value.trim() || "admin console currency adjustment";
  const player = state.selectedPlayerData.player;

  await request(`/admin/players/${encodeURIComponent(player.discordId)}/grant`, {
    method: "POST",
    body: JSON.stringify({ displayName: player.displayName, currencyType, amount, reason, adminId: "admin-console" })
  });

  await loadPlayerDetail(player.discordId, state);
  log(`已對 ${player.displayName} ${amount > 0 ? "增加" : "扣除"} ${Math.abs(amount)} ${currencyType}`);
}

async function submitExpAction(state) {
  if (!state.selectedPlayerData) throw new Error("請先選擇一位玩家");

  const amount = Number(document.getElementById("exp-amount-input").value);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("經驗值必須是正整數");

  const player = state.selectedPlayerData.player;
  const reason = document.getElementById("exp-reason-input").value.trim() || "admin console exp adjustment";

  await request(`/admin/players/${encodeURIComponent(player.discordId)}/grant-exp`, {
    method: "POST",
    body: JSON.stringify({ displayName: player.displayName, amount, reason, adminId: "admin-console" })
  });

  await loadPlayerDetail(player.discordId, state);
  log(`已對 ${player.displayName} 發放 ${amount} 經驗`);
}
