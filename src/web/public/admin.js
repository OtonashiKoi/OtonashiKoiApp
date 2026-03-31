// 管理後台主程式：狀態、事件綁定、頁面初始化
// ------------------------------------------------

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

function showSection(targetId) {
  document.querySelectorAll(".panel-section").forEach((section) => {
    section.classList.toggle("active", section.id === targetId);
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.target === targetId);
  });
}

function saveAuth() {
  localStorage.setItem("admin-password", document.getElementById("admin-password").value);
}

function loadAuth() {
  document.getElementById("admin-password").value = localStorage.getItem("admin-password") || "";
}

async function bootstrapConsole() {
  saveAuth();
  document.getElementById("connection-state").textContent = "連線中...";
  const data = await request("/admin/console/bootstrap");
  state.accessControl = data.accessControl;
  state.channelLayout = data.channelLayout;
  state.channels = data.discord.channels;
  state.roles = data.discord.roles;
  renderBindings(state);
  renderAccessControl(state);
  renderPlayerList(state);
  document.getElementById("connection-state").textContent = `已連線，載入 ${state.channels.length} 個頻道與 ${state.roles.length} 個身分組`;
  log("後台資料已成功載入");
  await loadPlayers(state);
}

function initSplitters() {
  // shell 側欄寬度拖曳
  const shell = document.getElementById("app-shell");
  const shellSplitter = document.getElementById("shell-splitter");
  if (shell && shellSplitter) {
    let dragging = false, startX = 0;
    const min = 180, max = 520;
    const saved = localStorage.getItem("shellLeftWidth");
    if (saved) shell.style.gridTemplateColumns = `${parseInt(saved, 10)}px 1fr`;

    const updateShellSplitter = () => {
      try {
        const leftPx = parseInt(getComputedStyle(shell).gridTemplateColumns.split(" ")[0], 10) || 280;
        shellSplitter.style.left = `${leftPx}px`;
        shellSplitter.style.height = `${shell.getBoundingClientRect().height}px`;
      } catch (_) {}
    };
    updateShellSplitter();

    shellSplitter.addEventListener("mousedown", (e) => {
      dragging = true; startX = e.clientX;
      document.body.style.userSelect = "none";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const newLeft = Math.max(min, Math.min(max,
        (parseInt(getComputedStyle(shell).gridTemplateColumns.split(" ")[0], 10) || 280) + (e.clientX - startX)
      ));
      startX = e.clientX;
      shell.style.gridTemplateColumns = `${newLeft}px 1fr`;
      localStorage.setItem("shellLeftWidth", String(newLeft));
      updateShellSplitter();
    });
    window.addEventListener("mouseup", () => { dragging = false; document.body.style.userSelect = ""; });
  }

  // 玩家列表寬度拖曳
  const playerGrid = document.querySelector(".player-grid");
  const playerSplitter = document.getElementById("player-splitter");
  if (playerGrid && playerSplitter) {
    let draggingP = false, startPX = 0;
    const minP = 200, maxP = 520;
    const savedP = localStorage.getItem("playerListWidth");
    if (savedP) playerGrid.style.gridTemplateColumns = `${parseInt(savedP, 10)}px 1fr`;

    const updatePlayerSplitter = () => {
      try {
        const first = parseInt(getComputedStyle(playerGrid).gridTemplateColumns.split(" ")[0], 10) || 260;
        playerSplitter.style.left = `${first}px`;
        playerSplitter.style.height = `${playerGrid.getBoundingClientRect().height}px`;
        playerSplitter.style.top = "0px";
      } catch (_) {}
    };
    updatePlayerSplitter();

    playerSplitter.addEventListener("mousedown", (e) => {
      draggingP = true; startPX = e.clientX;
      document.body.style.userSelect = "none";
    });
    window.addEventListener("mousemove", (e) => {
      if (!draggingP) return;
      const newLeft = Math.max(minP, Math.min(maxP,
        (parseInt(getComputedStyle(playerGrid).gridTemplateColumns.split(" ")[0], 10) || 260) + (e.clientX - startPX)
      ));
      startPX = e.clientX;
      playerGrid.style.gridTemplateColumns = `${newLeft}px 1fr`;
      localStorage.setItem("playerListWidth", String(newLeft));
      updatePlayerSplitter();
    });
    window.addEventListener("mouseup", () => { draggingP = false; document.body.style.userSelect = ""; });
  }
}

function bindEvents() {
  document.getElementById("connect-button").addEventListener("click", async () => {
    try {
      await bootstrapConsole();
    } catch (error) {
      document.getElementById("connection-state").textContent = error.message;
      log(`連線失敗：${error.message}`);
    }
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => showSection(link.dataset.target));
  });

  document.getElementById("sync-permissions-button").addEventListener("click", async () => {
    const btn = document.getElementById("sync-permissions-button");
    try {
      if (!state.channelLayout) { log("請先連線再同步"); return; }
      btn.disabled = true;
      btn.textContent = "同步中…";
      const data = await request("/admin/channel-layout/sync-permissions", { method: "POST", body: "{}" });
      const granted = data.reduce((sum, r) => sum + r.granted, 0);
      const revoked = data.reduce((sum, r) => sum + r.revoked, 0);
      log(`已同步 ${data.length} 個頻道：授予 ${granted} 個、移除 ${revoked} 個身分組讀取權限`);
    } catch (error) {
      log(`同步頻道權限失敗：${error.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "同步頻道讀取權限到 Discord";
    }
  });

  document.getElementById("save-layout-button").addEventListener("click", async () => {
    try { await saveLayout(state); } catch (error) { log(`儲存版位設定失敗：${error.message}`); }
  });

  document.getElementById("refresh-players-button").addEventListener("click", async () => {
    try { await loadPlayers(state); } catch (error) { log(`載入玩家列表失敗：${error.message}`); }
  });

  document.getElementById("player-search-input").addEventListener("input", (e) => {
    state.playerSearchKeyword = e.target.value;
    renderPlayerList(state);
  });

  document.getElementById("player-list").addEventListener("click", async (event) => {
    const target = event.target.closest(".player-row");
    if (!target) return;
    try {
      await loadPlayerDetail(target.dataset.discordId, state);
      log(`已載入玩家 ${target.dataset.discordId} 詳細資料`);
    } catch (error) {
      log(`載入玩家詳細資料失敗：${error.message}`);
    }
  });

  document.getElementById("currency-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await submitCurrencyAction(state); } catch (error) { log(`資源調整失敗：${error.message}`); }
  });

  document.getElementById("exp-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await submitExpAction(state); } catch (error) { log(`經驗調整失敗：${error.message}`); }
  });

  document.getElementById("save-admin-roles-button").addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/discord-roles",
        { adminRoleIds: getSelectedRoleIds(document.getElementById("admin-role-list")) },
        "管理員身分組已更新",
        state
      );
    } catch (error) { log(`儲存管理員身分組失敗：${error.message}`); }
  });

  document.getElementById("save-player-roles-button").addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/player-roles",
        { playerRoleIds: getSelectedRoleIds(document.getElementById("player-role-list")) },
        "玩家身分組已更新",
        state
      );
    } catch (error) { log(`儲存玩家身分組失敗：${error.message}`); }
  });

  document.getElementById("save-admin-users-button").addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/discord-users",
        { adminUserIds: splitLines(document.getElementById("admin-user-ids").value) },
        "管理員使用者已更新",
        state
      );
    } catch (error) { log(`儲存管理員使用者失敗：${error.message}`); }
  });

  document.getElementById("save-player-users-button").addEventListener("click", async () => {
    try {
      await saveAccessControl(
        "/admin/access-control/player-users",
        { playerUserIds: splitLines(document.getElementById("player-user-ids").value) },
        "玩家使用者已更新",
        state
      );
    } catch (error) { log(`儲存玩家使用者失敗：${error.message}`); }
  });

  const topRefresh = document.getElementById("top-refresh");
  if (topRefresh) {
    topRefresh.addEventListener("click", async () => {
      const refreshBtn = document.getElementById("refresh-players-button");
      try {
        if (refreshBtn) refreshBtn.disabled = true;
        topRefresh.disabled = true;
        await loadPlayers(state);
        log("頂欄：已重新載入玩家列表");
      } catch (err) {
        log(`重新載入玩家列表失敗：${err.message}`);
      } finally {
        if (refreshBtn) refreshBtn.disabled = false;
        topRefresh.disabled = false;
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", initSplitters);
loadAuth();
bindEvents();
setPlayerActionEnabled(false);
showSection("section-auth");