/* admin.players.init.js - initialization and event wiring separated to reduce file size */
(function () {
  const { request, log, splitLines, showSection } = window.adminCore;
  const state = window.state;
  const elements = window.elements;

  /* Resizable splitters for shell and player list */
  function initSplitters() {
    const shell = document.getElementById('app-shell');
    const shellSplitter = document.getElementById('shell-splitter');
    if (shell && shellSplitter) {
      let dragging = false;
      let startX = 0;
      const min = 180;
      const max = 520;
      const saved = localStorage.getItem('shellLeftWidth');
      if (saved) {
        shell.style.gridTemplateColumns = `${parseInt(saved,10)} 1fr`;
      }

      const updateShellSplitter = () => {
        try {
          const leftPx = parseInt(getComputedStyle(shell).gridTemplateColumns.split(' ')[0], 10) || 280;
          shellSplitter.style.left = `${leftPx}px`;
          shellSplitter.style.height = `${shell.getBoundingClientRect().height}px`;
        } catch (e) {}
      };
      updateShellSplitter();

      shellSplitter.addEventListener('mousedown', (e) => {
        dragging = true; startX = e.clientX;
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

    // player-splitter
    const playerGrid = document.querySelector('.player-grid');
    const playerSplitter = document.getElementById('player-splitter');
    if (playerGrid && playerSplitter) {
      let draggingP = false;
      let startPX = 0;
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
        draggingP = true; startPX = e.clientX;
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

  function bindEvents() {
    elements.connectButton.addEventListener("click", async () => {
      try {
        if (window.adminBindings && typeof window.adminBindings.bootstrapConsole === 'function') {
          await window.adminBindings.bootstrapConsole();
        }
        document.dispatchEvent(new Event("adminConnected"));
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
        if (window.adminBindings && typeof window.adminBindings.saveLayout === 'function') {
          await window.adminBindings.saveLayout();
        }
      } catch (error) {
        log(`儲存版位設定失敗：${error.message}`);
      }
    });

    elements.refreshPlayersButton.addEventListener("click", async () => {
      try {
        await window.adminPlayers.loadPlayers();
      } catch (error) {
        log(`載入玩家列表失敗：${error.message}`);
      }
    });

    elements.playerSearchInput.addEventListener("input", () => {
      state.playerSearchKeyword = elements.playerSearchInput.value;
      if (window.adminPlayers && typeof window.adminPlayers.renderPlayerList === 'function') {
        window.adminPlayers.renderPlayerList();
      }
    });

    elements.playerList.addEventListener("click", async (event) => {
      const target = event.target.closest(".player-row");
      if (!target) return;

      try {
        await window.adminPlayers.loadPlayerDetail(target.dataset.discordId);
        log(`已載入玩家 ${target.dataset.discordId} 詳細資料`);
      } catch (error) {
        log(`載入玩家詳細資料失敗：${error.message}`);
      }
    });

    elements.currencyActionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await window.adminPlayers.submitCurrencyAction?.();
      } catch (error) {
        log(`資源調整失敗：${error.message}`);
      }
    });

    elements.expActionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await window.adminPlayers.submitExpAction?.();
      } catch (error) {
        log(`經驗調整失敗：${error.message}`);
      }
    });

    const grantItemForm = document.getElementById("grant-item-form");
    if (grantItemForm) {
      grantItemForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const btn = document.getElementById("grant-item-submit");
        try {
          if (btn) { btn.disabled = true; btn.textContent = "發放中…"; }
          await window.adminPlayers.submitGrantItem?.();
        } catch (error) {
          log(`發放道具失敗：${error.message}`);
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "發放到背包"; }
        }
      });
    }

    elements.saveAdminRolesButton.addEventListener("click", async () => {
      try {
        if (window.adminBindings && typeof window.adminBindings.getSelectedRoleIds === 'function') {
          await window.adminPlayers.saveAccessControl(
            "/admin/access-control/discord-roles",
            { adminRoleIds: window.adminBindings.getSelectedRoleIds(elements.adminRoleList) },
            "管理員身分組已更新"
          );
        }
      } catch (error) {
        log(`儲存管理員身分組失敗：${error.message}`);
      }
    });

    elements.savePlayerRolesButton.addEventListener("click", async () => {
      try {
        if (window.adminBindings && typeof window.adminBindings.getSelectedRoleIds === 'function') {
          await window.adminPlayers.saveAccessControl(
            "/admin/access-control/player-roles",
            { playerRoleIds: window.adminBindings.getSelectedRoleIds(elements.playerRoleList) },
            "玩家身分組已更新"
          );
        }
      } catch (error) {
        log(`儲存玩家身分組失敗：${error.message}`);
      }
    });

    elements.saveAdminUsersButton.addEventListener("click", async () => {
      try {
        await window.adminPlayers.saveAccessControl(
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
        await window.adminPlayers.saveAccessControl(
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
          await window.adminPlayers.loadPlayers();
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

  // initialize
  document.addEventListener('DOMContentLoaded', initSplitters);
  adminCore.loadAuth();
  bindEvents();
  setPlayerActionEnabled(false);
  showSection("section-auth");

  // expose some functions for other modules
  window.adminPlayers.submitCurrencyAction = window.adminPlayers.submitCurrencyAction || null;
  window.adminPlayers.submitExpAction = window.adminPlayers.submitExpAction || null;
  window.adminPlayers.saveAccessControl = window.adminPlayers.saveAccessControl || null;
})();
