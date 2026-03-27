const state = {
  accessControl: null,
  channelLayout: null,
  channels: [],
  roles: [],
  players: [],
  selectedPlayerId: "",
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
  playerList: document.getElementById("player-list"),
  playerDetail: document.getElementById("player-detail")
};

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

  if (state.players.length === 0) {
    elements.playerList.textContent = "目前還沒有玩家資料。";
    return;
  }

  for (const player of state.players) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "player-row";
    row.dataset.discordId = player.discordId;
    if (player.discordId === state.selectedPlayerId) {
      row.classList.add("active");
    }
    row.innerHTML = `<strong>${player.displayName || "unknown"}</strong><small>${player.discordId}</small>`;
    elements.playerList.appendChild(row);
  }
}

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

  const lines = [
    "玩家詳細資料",
    "----------------------------",
    `Discord ID: ${data.player.discordId}`,
    `玩家名稱: ${data.player.displayName}`,
    `狀態: ${data.player.status}`,
    `等級: ${data.progress.level}`,
    `經驗: ${data.progress.exp}`,
    `金幣: ${data.wallet.gold}`,
    `鑽石: ${data.wallet.diamond}`,
    "",
    "最近交易:",
    ...(data.transactions.length > 0 ? data.transactions.map(formatTransaction) : ["無交易紀錄"])
  ];

  elements.playerDetail.textContent = lines.join("\n");
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
}

loadAuth();
bindEvents();
showSection("section-auth");