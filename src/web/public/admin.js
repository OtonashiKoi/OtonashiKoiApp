const state = {
  accessControl: null,
  channelLayout: null,
  channels: [],
  roles: [],
  players: [],
  selectedPlayerId: "",
  selectedPlayerData: null,
  playerSearchKeyword: "",
  channelKeywords: {}
};

const elements = {
  adminPassword: document.getElementById("admin-password"),
  connectButton: document.getElementById("connect-button"),
  connectionState: document.getElementById("connection-state"),
  bindingList: document.getElementById("binding-list"),
  saveLayoutButton: document.getElementById("save-layout-button"),
  syncPermissionsButton: document.getElementById("sync-permissions-button"),
  adminRoleList: document.getElementById("admin-role-list"),
  playerRoleList: document.getElementById("player-role-list"),
  adminUserIds: document.getElementById("admin-user-ids"),
  playerUserIds: document.getElementById("player-user-ids"),
  saveAdminRolesButton: document.getElementById("save-admin-roles-button"),
  savePlayerRolesButton: document.getElementById("save-player-roles-button"),
  saveAdminUsersButton: document.getElementById("save-admin-users-button"),
  savePlayerUsersButton: document.getElementById("save-player-users-button"),
  activityLog: document.getElementById("activity-log"),
  navLinks: [...document.querySelectorAll(".nav-link")],
  sections: [...document.querySelectorAll(".panel-section")],
  refreshPlayersButton: document.getElementById("refresh-players-button"),
  playerSearchInput: document.getElementById("player-search-input"),
  playerListSummary: document.getElementById("player-list-summary"),
  playerList: document.getElementById("player-list"),
  playerDetail: document.getElementById("player-detail"),
  playerDetailView: document.getElementById("player-detail-view"),
  playerNameHeading: document.getElementById("player-name-heading"),
  playerIdLine: document.getElementById("player-id-line"),
  playerStatusBadge: document.getElementById("player-status-badge"),
  playerLevelValue: document.getElementById("player-level-value"),
  playerExpValue: document.getElementById("player-exp-value"),
  playerGoldValue: document.getElementById("player-gold-value"),
  playerDiamondValue: document.getElementById("player-diamond-value"),
  playerCreatedAt: document.getElementById("player-created-at"),
  playerUpdatedAt: document.getElementById("player-updated-at"),
  playerWalletUpdatedAt: document.getElementById("player-wallet-updated-at"),
  playerProgressUpdatedAt: document.getElementById("player-progress-updated-at"),
  playerTransactionList: document.getElementById("player-transaction-list"),
  currencyActionForm: document.getElementById("currency-action-form"),
  currencyTypeInput: document.getElementById("currency-type-input"),
  currencyOperationInput: document.getElementById("currency-operation-input"),
  currencyAmountInput: document.getElementById("currency-amount-input"),
  currencyReasonInput: document.getElementById("currency-reason-input"),
  currencySubmitButton: document.getElementById("currency-submit-button"),
  expActionForm: document.getElementById("exp-action-form"),
  expAmountInput: document.getElementById("exp-amount-input"),
  expReasonInput: document.getElementById("exp-reason-input"),
  expSubmitButton: document.getElementById("exp-submit-button")
};

elements.topRefresh = document.getElementById("top-refresh");

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${elements.adminPassword.value.trim()}`
  };

  return headers;
}

function saveAuth() {
  localStorage.setItem("admin-password", elements.adminPassword.value);
}

function loadAuth() {
  elements.adminPassword.value = localStorage.getItem("admin-password") || "";
}

function log(message) {
  const stamp = new Date().toLocaleString("zh-TW", { hour12: false });
  elements.activityLog.textContent = `[${stamp}] ${message}\n${elements.activityLog.textContent}`.trim();
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed: ${response.status}`);
  }

  return payload.data;
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-TW", { hour12: false });
}

function togglePlayerDetail(hasSelection) {
  elements.playerDetail.classList.toggle("hidden", hasSelection);
  elements.playerDetailView.classList.toggle("hidden", !hasSelection);
}

function setPlayerActionEnabled(enabled) {
  elements.currencyTypeInput.disabled = !enabled;
  elements.currencyOperationInput.disabled = !enabled;
  elements.currencyAmountInput.disabled = !enabled;
  elements.currencyReasonInput.disabled = !enabled;
  elements.currencySubmitButton.disabled = !enabled;
  elements.expAmountInput.disabled = !enabled;
  elements.expReasonInput.disabled = !enabled;
  elements.expSubmitButton.disabled = !enabled;
}

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
  elements.playerGoldValue.textContent = data.wallet.gold;
  elements.playerDiamondValue.textContent = data.wallet.diamond;
  elements.playerCreatedAt.textContent = formatDateTime(data.player.createdAt);
  elements.playerUpdatedAt.textContent = formatDateTime(data.player.updatedAt);
  elements.playerWalletUpdatedAt.textContent = formatDateTime(data.wallet.updatedAt);
  elements.playerProgressUpdatedAt.textContent = formatDateTime(data.progress.updatedAt);
  renderTransactions(data.transactions);
}

function createRoleChecklist(container, roles, selectedIds) {
  container.innerHTML = "";
  for (const role of roles) {
    const item = document.createElement("label");
    item.className = "role-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = role.id;
    checkbox.checked = selectedIds.includes(role.id);

    const swatch = document.createElement("span");
    swatch.className = "role-swatch";
    swatch.style.background = role.color === "#000000" ? "#7c6f64" : role.color;

    const text = document.createElement("span");
    text.textContent = `${role.name} (${role.id})`;

    item.append(checkbox, swatch, text);
    container.appendChild(item);
  }
}

function getSelectedRoleIds(container) {
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function updateChannelSelect(featureKey) {
  const keyword = (state.channelKeywords[featureKey] || "").trim().toLowerCase();
  const filtered = state.channels.filter((ch) => !keyword || ch.name.toLowerCase().includes(keyword));
  const article = elements.bindingList.querySelector(`[data-feature-key="${featureKey}"]`);
  if (!article) return;
  const select = article.querySelector('select[data-field="channelId"]');
  if (!select) return;
  const currentValue = select.value;
  const selectedNotInFiltered =
    currentValue && !filtered.some((ch) => ch.id === currentValue)
      ? `<option value="${currentValue}" selected>(目前已選) ${currentValue}</option>`
      : "";
  select.innerHTML =
    '<option value="">未指定頻道</option>' +
    selectedNotInFiltered +
    filtered.map((ch) => `<option value="${ch.id}" ${ch.id === currentValue ? "selected" : ""}>#${ch.name}</option>`).join("");
  const hint = article.querySelector(".channel-search-hint");
  if (hint) {
    hint.textContent = keyword ? `符合 ${filtered.length} 個頻道` : `共 ${state.channels.length} 個`;
  }
}

function renderBindings() {
  elements.bindingList.innerHTML = "";
  const bindings = state.channelLayout.discord.bindings;

  for (const feature of state.channelLayout.discord.availableFeatures) {
    const binding = bindings.find((item) => item.featureKey === feature.key) || {
      featureKey: feature.key,
      channelId: "",
      enabled: false,
      note: "",
      visibleTo: {
        player: true,
        admin: true
      }
    };

    const keyword = (state.channelKeywords[feature.key] || "").trim().toLowerCase();
    const filteredChannels = state.channels.filter((ch) => !keyword || ch.name.toLowerCase().includes(keyword));
    const hintText = keyword ? `符合 ${filteredChannels.length} 個頻道` : `共 ${state.channels.length} 個`;

    const wrapper = document.createElement("article");
    wrapper.className = "binding-item";
    wrapper.dataset.featureKey = feature.key;

    const selectedNotInFiltered =
      binding.channelId && !filteredChannels.some((ch) => ch.id === binding.channelId)
        ? `<option value="${binding.channelId}" selected>(目前已選) ${binding.channelId}</option>`
        : "";

    const channelOptions =
      '<option value="">未指定頻道</option>' +
      selectedNotInFiltered +
      filteredChannels.map((ch) => `<option value="${ch.id}" ${ch.id === binding.channelId ? "selected" : ""}>#${ch.name}</option>`).join("");

    wrapper.innerHTML = `
      <header>
        <div>
          <strong>${feature.label}</strong>
          <p>${feature.description}</p>
        </div>
      </header>
      <div class="binding-controls">
        <div class="channel-search-mini">
          <input data-channel-search="${feature.key}" type="text" placeholder="搜尋頻道…" value="${(state.channelKeywords[feature.key] || "")}" />
          <span class="channel-search-hint">${hintText}</span>
        </div>
        <label class="field field-channel">
          <span>Discord 頻道</span>
          <select data-field="channelId">${channelOptions}</select>
        </label>
        <label class="field field-note">
          <span>備註</span>
          <input data-field="note" type="text" value="${binding.note}" placeholder="例如：新手入口、GM 管理頻道" />
        </label>
        <label class="toggle binding-toggle">
          <input data-field="enabled" type="checkbox" ${binding.enabled ? "checked" : ""} />
          啟用這個功能綁定
        </label>
        <div class="audience-row binding-audience">
          <span>可見對象：</span>
          <label>
            <input data-field="visible-player" type="checkbox" ${binding.visibleTo?.player ? "checked" : ""} />
            玩家
          </label>
          <label>
            <input data-field="visible-admin" type="checkbox" ${binding.visibleTo?.admin ? "checked" : ""} />
            管理員
          </label>
        </div>
      </div>
    `;

    elements.bindingList.appendChild(wrapper);

    const searchInput = wrapper.querySelector(`[data-channel-search="${feature.key}"]`);
    searchInput.addEventListener("input", () => {
      state.channelKeywords[feature.key] = searchInput.value;
      updateChannelSelect(feature.key);
    });
  }
}

function renderAccessControl() {
  const discord = state.accessControl.discord;
  createRoleChecklist(elements.adminRoleList, state.roles, discord.adminRoleIds);
  createRoleChecklist(elements.playerRoleList, state.roles, discord.playerRoleIds);
  elements.adminUserIds.value = discord.adminUserIds.join("\n");
  elements.playerUserIds.value = discord.playerUserIds.join("\n");
}

function renderAll() {
  renderBindings();
  renderAccessControl();
  renderPlayerList();
}

function collectBindings() {
  return [...elements.bindingList.querySelectorAll(".binding-item")].map((item) => ({
    featureKey: item.dataset.featureKey,
    channelId: item.querySelector('[data-field="channelId"]').value,
    note: item.querySelector('[data-field="note"]').value.trim(),
    enabled: item.querySelector('[data-field="enabled"]').checked,
    visibleTo: {
      player: item.querySelector('[data-field="visible-player"]').checked,
      admin: item.querySelector('[data-field="visible-admin"]').checked
    }
  }));
}

async function bootstrapConsole() {
  saveAuth();
  elements.connectionState.textContent = "連線中...";
  const data = await request("/admin/console/bootstrap");
  state.accessControl = data.accessControl;
  state.channelLayout = data.channelLayout;
  state.channels = data.discord.channels;
  state.roles = data.discord.roles;
  renderAll();
  elements.connectionState.textContent = `已連線，載入 ${state.channels.length} 個頻道與 ${state.roles.length} 個身分組`;
  log("後台資料已成功載入");

  await loadPlayers();
}

async function saveLayout() {
  const data = await request("/admin/channel-layout", {
    method: "PUT",
    body: JSON.stringify({ bindings: collectBindings() })
  });
  state.channelLayout = data;
  renderBindings();
  log("Discord 版位設定已儲存");
}

function showSection(targetId) {
  for (const section of elements.sections) {
    section.classList.toggle("active", section.id === targetId);
  }

  for (const link of elements.navLinks) {
    link.classList.toggle("active", link.dataset.target === targetId);
  }
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

/* Resizable splitters for shell and player list */
function initSplitters() {
  // shell splitter (left sidebar width)
  const shell = document.getElementById('app-shell');
  const shellSplitter = document.getElementById('shell-splitter');
  if (shell && shellSplitter) {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const min = 180;
    const max = 520;
    const saved = localStorage.getItem('shellLeftWidth');
    if (saved) {
      shell.style.gridTemplateColumns = `${parseInt(saved,10)} 1fr`;
    }

    // position splitter based on current left column width
    const updateShellSplitter = () => {
      try {
        const leftPx = parseInt(getComputedStyle(shell).gridTemplateColumns.split(' ')[0], 10) || 280;
        shellSplitter.style.left = `${leftPx}px`;
        shellSplitter.style.height = `${shell.getBoundingClientRect().height}px`;
      } catch (e) {}
    };
    updateShellSplitter();

    shellSplitter.addEventListener('mousedown', (e) => {
      dragging = true; startX = e.clientX; startWidth = shell.getBoundingClientRect().width;
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newLeft = Math.max(min, Math.min(max, (parseInt(getComputedStyle(shell).gridTemplateColumns.split(' ')[0],10) || 280) + delta));
      shell.style.gridTemplateColumns = `${newLeft}px 1fr`;
      localStorage.setItem('shellLeftWidth', String(newLeft));
      updateShellSplitter();
    });

    window.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
  }

  // player-splitter (within player-grid)
  const playerGrid = document.querySelector('.player-grid');
  const playerSplitter = document.getElementById('player-splitter');
  if (playerGrid && playerSplitter) {
    let draggingP = false;
    let startPX = 0;
    let startLeft = 0;
    const minP = 200;
    const maxP = 520;
    const savedP = localStorage.getItem('playerListWidth');
    if (savedP) {
      playerGrid.style.gridTemplateColumns = `${parseInt(savedP,10)} 1fr`;
    }

    const updatePlayerSplitter = () => {
      try {
        const first = parseInt(getComputedStyle(playerGrid).gridTemplateColumns.split(' ')[0],10) || 260;
        playerSplitter.style.left = `${first}px`;
        playerSplitter.style.height = `${playerGrid.getBoundingClientRect().height}px`;
        playerSplitter.style.top = `0px`;
      } catch (e) {}
    };
    updatePlayerSplitter();

    playerSplitter.addEventListener('mousedown', (e) => {
      draggingP = true; startPX = e.clientX; startLeft = playerGrid.getBoundingClientRect().width;
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!draggingP) return;
      const delta = e.clientX - startPX;
      const computed = getComputedStyle(playerGrid).gridTemplateColumns.split(' ')[0];
      const currentLeft = parseInt(computed,10) || 260;
      const newLeft = Math.max(minP, Math.min(maxP, currentLeft + delta));
      playerGrid.style.gridTemplateColumns = `${newLeft}px 1fr`;
      localStorage.setItem('playerListWidth', String(newLeft));
      updatePlayerSplitter();
    });

    window.addEventListener('mouseup', () => { draggingP = false; document.body.style.userSelect = ''; });
  }
}

document.addEventListener('DOMContentLoaded', initSplitters);

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
  renderAccessControl();
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

function bindEvents() {
  elements.connectButton.addEventListener("click", async () => {
    try {
      await bootstrapConsole();
    } catch (error) {
      elements.connectionState.textContent = error.message;
      log(`連線失敗：${error.message}`);
    }
  });

  for (const link of elements.navLinks) {
    link.addEventListener("click", () => {
      showSection(link.dataset.target);
    });
  }

  elements.syncPermissionsButton.addEventListener("click", async () => {
    try {
      if (!state.channelLayout) { log("請先連線再同步"); return; }
      elements.syncPermissionsButton.disabled = true;
      elements.syncPermissionsButton.textContent = "同步中…";
      const data = await request("/admin/channel-layout/sync-permissions", { method: "POST", body: "{}" });
      const granted = data.reduce((sum, r) => sum + r.granted, 0);
      const revoked = data.reduce((sum, r) => sum + r.revoked, 0);
      log(`已同步 ${data.length} 個頻道：授予 ${granted} 個、移除 ${revoked} 個身分組讀取權限`);
    } catch (error) {
      log(`同步頻道權限失敗：${error.message}`);
    } finally {
      elements.syncPermissionsButton.disabled = false;
      elements.syncPermissionsButton.textContent = "同步頻道讀取權限到 Discord";
    }
  });

  elements.saveLayoutButton.addEventListener("click", async () => {
    try {
      await saveLayout();
    } catch (error) {
      log(`儲存版位設定失敗：${error.message}`);
    }
  });

  elements.refreshPlayersButton.addEventListener("click", async () => {
    try {
      await loadPlayers();
    } catch (error) {
      log(`載入玩家列表失敗：${error.message}`);
    }
  });

  elements.playerSearchInput.addEventListener("input", () => {
    state.playerSearchKeyword = elements.playerSearchInput.value;
    renderPlayerList();
  });

  elements.playerList.addEventListener("click", async (event) => {
    const target = event.target.closest(".player-row");
    if (!target) return;

    try {
      await loadPlayerDetail(target.dataset.discordId);
      log(`已載入玩家 ${target.dataset.discordId} 詳細資料`);
    } catch (error) {
      log(`載入玩家詳細資料失敗：${error.message}`);
    }
  });

  elements.currencyActionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await submitCurrencyAction();
    } catch (error) {
      log(`資源調整失敗：${error.message}`);
    }
  });

  elements.expActionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await submitExpAction();
    } catch (error) {
      log(`經驗調整失敗：${error.message}`);
    }
  });

  elements.saveAdminRolesButton.addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/discord-roles",
        { adminRoleIds: getSelectedRoleIds(elements.adminRoleList) },
        "管理員身分組已更新"
      );
    } catch (error) {
      log(`儲存管理員身分組失敗：${error.message}`);
    }
  });

  elements.savePlayerRolesButton.addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/player-roles",
        { playerRoleIds: getSelectedRoleIds(elements.playerRoleList) },
        "玩家身分組已更新"
      );
    } catch (error) {
      log(`儲存玩家身分組失敗：${error.message}`);
    }
  });

  elements.saveAdminUsersButton.addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/discord-users",
        { adminUserIds: splitLines(elements.adminUserIds.value) },
        "管理員使用者已更新"
      );
    } catch (error) {
      log(`儲存管理員使用者失敗：${error.message}`);
    }
  });

  elements.savePlayerUsersButton.addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/player-users",
        { playerUserIds: splitLines(elements.playerUserIds.value) },
        "玩家使用者已更新"
      );
    } catch (error) {
      log(`儲存玩家使用者失敗：${error.message}`);
    }
  });

  if (elements.topRefresh) {
    elements.topRefresh.addEventListener("click", async () => {
      try {
        elements.refreshPlayersButton.disabled = true;
        elements.topRefresh.disabled = true;
        await loadPlayers();
        log("頂欄：已重新載入玩家列表");
      } catch (err) {
        log(`重新載入玩家列表失敗：${err.message}`);
      } finally {
        elements.refreshPlayersButton.disabled = false;
        elements.topRefresh.disabled = false;
      }
    });
  }
}

loadAuth();
bindEvents();
setPlayerActionEnabled(false);
showSection("section-auth");