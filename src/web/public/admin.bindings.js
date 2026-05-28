/* admin.bindings.js - bindings and access control UI */
(function () {
  const { request, log, escapeHtml } = window.adminCore;
  const state = window.state;
  const elements = window.elements;

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

    const allFeatures = state.channelLayout.discord.availableFeatures;
    const inferCategory = (f) => f.category || (f.key.startsWith("monster_zone") ? "monster" : "system");
    const groupBy = (cat) => allFeatures.filter(f => inferCategory(f) === cat);
    const systemFeatures = groupBy("system");
    const socialFeatures = groupBy("social");
    const pkPartyFeatures = groupBy("pk_party");
    const monsterFeatures = groupBy("monster");

    function renderGroup(features, groupLabel) {
      const groupHeader = document.createElement("div");
      groupHeader.className = "binding-group-header";
      groupHeader.innerHTML = `<span class="binding-group-label">${groupLabel}</span>`;
      elements.bindingList.appendChild(groupHeader);
      for (const feature of features) {
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

      const PUBLISH_ENDPOINTS = {
        personal_room:  "/admin/channel-layout/publish-player-panel",
        player_query:   "/admin/channel-layout/publish-player-query",
        daily_quest:    "/admin/channel-layout/publish-daily-quest",
        weekly_quest:   "/admin/channel-layout/publish-weekly-quest",
        idle_zone:      "/admin/channel-layout/publish-idle-zone",
        pet_panel:      "/admin/channel-layout/publish-pet-panel",
        coin_shop:      "/admin/channel-layout/publish-coin-shop",
        auction_house:  "/admin/auction/publish",
        pk_arena:       "/admin/channel-layout/publish-pk-arena",
        party_lobby:    "/admin/channel-layout/publish-tower-hall",
        casino_wheel:   "/admin/channel-layout/publish-casino",
      };
      const publishEndpoint = PUBLISH_ENDPOINTS[feature.key]
        || (feature.key.startsWith("monster_zone") ? "/admin/channel-layout/publish-monster-zone" : null);

      const publishBtn = publishEndpoint
        ? `<button class="button publish-panel-btn" data-publish-endpoint="${publishEndpoint}" title="將按鈕面板發布到已選頻道">📨 發布面板</button>`
        : "";

      const isMonsterZone = feature.key.startsWith("monster_zone");
      const zoneLevelHtml = isMonsterZone ? `
        <div class="field-row" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
          <label class="field" style="flex:1;min-width:100px;">
            <span>最低等級（含）</span>
            <input data-field="minLevel" type="number" min="0" max="999" step="1"
              value="${binding.minLevel != null ? binding.minLevel : ""}"
              placeholder="不限" style="width:100%;" />
          </label>
          <label class="field" style="flex:1;min-width:100px;">
            <span>最高等級（含）</span>
            <input data-field="maxLevel" type="number" min="0" max="999" step="1"
              value="${binding.maxLevel != null ? binding.maxLevel : ""}"
              placeholder="不限" style="width:100%;" />
          </label>
          <p class="hint" style="margin:0;font-size:0.8em;color:var(--muted,#888);flex-basis:100%;">留空 = 沿用系統預設；填入數值可覆蓋預設限制</p>
        </div>` : "";

      wrapper.innerHTML = `
      <header>
        <div>
          <strong>${feature.label}</strong>
          <p>${feature.description}</p>
        </div>
        <div class="actions">${publishBtn}</div>
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
        ${zoneLevelHtml}
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

      if (publishEndpoint) {
        const btn = wrapper.querySelector(".publish-panel-btn");
        btn.addEventListener("click", async () => {
          const channelId = wrapper.querySelector('[data-field="channelId"]').value;
          if (!channelId) { log("請先選擇頻道再發布面板"); return; }
          btn.disabled = true;
          btn.textContent = "發布中…";
          try {
            await request(publishEndpoint, { method: "POST", body: JSON.stringify({ channelId }) });
            log(`✅ 面板已發布到頻道 ${channelId}`);
          } catch (err) {
            log(`❌ 發布失敗：${err.message}`);
          } finally {
            btn.disabled = false;
            btn.textContent = "📨 發布面板";
          }
        });
      }
      } // end for feature
    } // end renderGroup

    renderGroup(systemFeatures, "⚙️ 系統面板");
    if (socialFeatures.length) renderGroup(socialFeatures, "💬 社群頻道");
    if (pkPartyFeatures.length) renderGroup(pkPartyFeatures, "⚔️ PK / 組隊頻道");
    renderGroup(monsterFeatures, "🗺️ 怪物地圖面板");
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
    // player list rendering left to players module
  }

  function collectBindings() {
    return [...elements.bindingList.querySelectorAll(".binding-item")].map((item) => {
      const fk = item.dataset.featureKey;
      const minLevelInput = item.querySelector('[data-field="minLevel"]');
      const maxLevelInput = item.querySelector('[data-field="maxLevel"]');
      const parseLevel = (input) => {
        if (!input) return undefined;
        const v = input.value.trim();
        if (v === "") return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      };
      const entry = {
        featureKey: fk,
        channelId: item.querySelector('[data-field="channelId"]').value,
        note: item.querySelector('[data-field="note"]').value.trim(),
        enabled: item.querySelector('[data-field="enabled"]').checked,
        visibleTo: {
          player: item.querySelector('[data-field="visible-player"]').checked,
          admin: item.querySelector('[data-field="visible-admin"]').checked
        }
      };
      if (fk.startsWith("monster_zone")) {
        entry.minLevel = parseLevel(minLevelInput);
        entry.maxLevel = parseLevel(maxLevelInput);
      }
      return entry;
    });
  }

  async function bootstrapConsole() {
    adminCore.saveAuth();
    elements.connectionState.textContent = "連線中...";
    const data = await request("/admin/console/bootstrap");
    state.accessControl = data.accessControl;
    state.channelLayout = data.channelLayout;
    state.channels = data.discord.channels;
    state.roles = data.discord.roles;
    // 同步存入 playerTiers，讓 shop.js 立即可用
    if (data.playerTiers) {
      window.playerTiers = data.playerTiers;
    }
    renderAll();
    elements.connectionState.textContent = `已連線，載入 ${state.channels.length} 個頻道與 ${state.roles.length} 個身分組`;
    log("後台資料已成功載入");

    // delegate player loading to players module
    if (window.adminPlayers && typeof window.adminPlayers.loadPlayers === 'function') {
      await window.adminPlayers.loadPlayers();
    }

    // 拍賣場管理載入
    if (window.__auctionAdmin && typeof window.__auctionAdmin.load === 'function') {
      await window.__auctionAdmin.load(data);
    }
  }

  async function saveLayout() {
    const data = await request("/admin/channel-layout", {
      method: "PUT",
      body: JSON.stringify({ bindings: collectBindings() })
    });
    state.channelLayout = data?.channelLayout || data;
    renderBindings();
    log("Discord 版位設定已儲存");
    if (Array.isArray(data?.syncReport)) {
      const changed = data.syncReport.reduce((sum, row) => sum + Number(row.granted || 0) + Number(row.revoked || 0), 0);
      log(`🔐 權限同步完成：${data.syncReport.length} 個綁定，變更 ${changed} 筆覆寫`);
    }
  }

  // expose bindings API
  window.adminBindings = {
    renderBindings,
    renderAccessControl,
    renderAll,
    collectBindings,
    bootstrapConsole,
    saveLayout,
    createRoleChecklist,
    getSelectedRoleIds
  };
})();
