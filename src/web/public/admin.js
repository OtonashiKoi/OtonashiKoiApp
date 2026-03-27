const state = {
  accessControl: null,
  channelLayout: null,
  channels: [],
  roles: []
};

const elements = {
  adminPassword: document.getElementById("admin-password"),
  connectButton: document.getElementById("connect-button"),
  connectionState: document.getElementById("connection-state"),
  bindingList: document.getElementById("binding-list"),
  saveLayoutButton: document.getElementById("save-layout-button"),
  publishPlayerPanelButton: document.getElementById("publish-player-panel-button"),
  adminRoleList: document.getElementById("admin-role-list"),
  playerRoleList: document.getElementById("player-role-list"),
  adminUserIds: document.getElementById("admin-user-ids"),
  playerUserIds: document.getElementById("player-user-ids"),
  saveAdminRolesButton: document.getElementById("save-admin-roles-button"),
  savePlayerRolesButton: document.getElementById("save-player-roles-button"),
  saveAdminUsersButton: document.getElementById("save-admin-users-button"),
  savePlayerUsersButton: document.getElementById("save-player-users-button"),
  activityLog: document.getElementById("activity-log")
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

function renderBindings() {
  elements.bindingList.innerHTML = "";
  const bindings = state.channelLayout.discord.bindings;

  for (const feature of state.channelLayout.discord.availableFeatures) {
    const binding = bindings.find((item) => item.featureKey === feature.key) || {
      featureKey: feature.key,
      channelId: "",
      enabled: false,
      note: ""
    };

    const wrapper = document.createElement("article");
    wrapper.className = "binding-item";
    wrapper.dataset.featureKey = feature.key;

    const channelOptions = ['<option value="">未指定頻道</option>']
      .concat(
        state.channels.map(
          (channel) =>
            `<option value="${channel.id}" ${channel.id === binding.channelId ? "selected" : ""}>#${channel.name}</option>`
        )
      )
      .join("");

    wrapper.innerHTML = `
      <header>
        <div>
          <strong>${feature.label}</strong>
          <p>${feature.description}</p>
        </div>
      </header>
      <div class="binding-controls">
        <label>
          <span>Discord 頻道</span>
          <select data-field="channelId">${channelOptions}</select>
        </label>
        <label>
          <span>備註</span>
          <input data-field="note" type="text" value="${binding.note}" placeholder="例如：新手入口、GM 管理頻道" />
        </label>
        <label class="toggle">
          <input data-field="enabled" type="checkbox" ${binding.enabled ? "checked" : ""} />
          啟用這個功能綁定
        </label>
      </div>
    `;

    elements.bindingList.appendChild(wrapper);
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
}

function collectBindings() {
  return [...elements.bindingList.querySelectorAll(".binding-item")].map((item) => ({
    featureKey: item.dataset.featureKey,
    channelId: item.querySelector('[data-field="channelId"]').value,
    note: item.querySelector('[data-field="note"]').value.trim(),
    enabled: item.querySelector('[data-field="enabled"]').checked
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

async function publishPlayerPanel() {
  const binding = collectBindings().find((item) => item.featureKey === "player_panel");
  if (!binding?.channelId) {
    throw new Error("請先替玩家操作面板指定頻道");
  }

  await request("/admin/channel-layout/publish-player-panel", {
    method: "POST",
    body: JSON.stringify({ channelId: binding.channelId })
  });
  log(`玩家面板已發布到頻道 ${binding.channelId}`);
}

async function saveAccessControl(url, body, successMessage) {
  const data = await request(url, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  state.accessControl = data;
  renderAccessControl();
  log(successMessage);
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

  elements.saveLayoutButton.addEventListener("click", async () => {
    try {
      await saveLayout();
    } catch (error) {
      log(`儲存版位設定失敗：${error.message}`);
    }
  });

  elements.publishPlayerPanelButton.addEventListener("click", async () => {
    try {
      await publishPlayerPanel();
    } catch (error) {
      log(`發布玩家面板失敗：${error.message}`);
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