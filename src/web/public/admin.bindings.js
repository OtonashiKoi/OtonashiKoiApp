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
    // player list rendering left to players module
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
    adminCore.saveAuth();
    elements.connectionState.textContent = "連線中...";
    const data = await request("/admin/console/bootstrap");
    state.accessControl = data.accessControl;
    state.channelLayout = data.channelLayout;
    state.channels = data.discord.channels;
    state.roles = data.discord.roles;
    renderAll();
    elements.connectionState.textContent = `已連線，載入 ${state.channels.length} 個頻道與 ${state.roles.length} 個身分組`;
    log("後台資料已成功載入");

    // delegate player loading to players module
    if (window.adminPlayers && typeof window.adminPlayers.loadPlayers === 'function') {
      await window.adminPlayers.loadPlayers();
    }
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
