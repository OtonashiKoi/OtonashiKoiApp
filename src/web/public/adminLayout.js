// 頻道版位綁定渲染與存取控制（角色/用戶清單）
// ------------------------------------------------

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

function updateChannelSelect(featureKey, state) {
  const bindingList = document.getElementById("binding-list");
  const keyword = (state.channelKeywords[featureKey] || "").trim().toLowerCase();
  const filtered = state.channels.filter((ch) => !keyword || ch.name.toLowerCase().includes(keyword));
  const article = bindingList.querySelector(`[data-feature-key="${featureKey}"]`);
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

function renderBindings(state) {
  const bindingList = document.getElementById("binding-list");
  bindingList.innerHTML = "";
  const bindings = state.channelLayout.discord.bindings;

  for (const feature of state.channelLayout.discord.availableFeatures) {
    const binding = bindings.find((item) => item.featureKey === feature.key) || {
      featureKey: feature.key,
      channelId: "",
      enabled: false,
      note: "",
      visibleTo: { player: true, admin: true }
    };

    const keyword = (state.channelKeywords[feature.key] || "").trim().toLowerCase();
    const filteredChannels = state.channels.filter((ch) => !keyword || ch.name.toLowerCase().includes(keyword));
    const hintText = keyword ? `符合 ${filteredChannels.length} 個頻道` : `共 ${state.channels.length} 個`;

    const selectedNotInFiltered =
      binding.channelId && !filteredChannels.some((ch) => ch.id === binding.channelId)
        ? `<option value="${binding.channelId}" selected>(目前已選) ${binding.channelId}</option>`
        : "";

    const channelOptions =
      '<option value="">未指定頻道</option>' +
      selectedNotInFiltered +
      filteredChannels.map((ch) => `<option value="${ch.id}" ${ch.id === binding.channelId ? "selected" : ""}>#${ch.name}</option>`).join("");

    const wrapper = document.createElement("article");
    wrapper.className = "binding-item";
    wrapper.dataset.featureKey = feature.key;
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

    bindingList.appendChild(wrapper);

    const searchInput = wrapper.querySelector(`[data-channel-search="${feature.key}"]`);
    searchInput.addEventListener("input", () => {
      state.channelKeywords[feature.key] = searchInput.value;
      updateChannelSelect(feature.key, state);
    });
  }
}

function renderAccessControl(state) {
  const discord = state.accessControl.discord;
  createRoleChecklist(document.getElementById("admin-role-list"), state.roles, discord.adminRoleIds);
  createRoleChecklist(document.getElementById("player-role-list"), state.roles, discord.playerRoleIds);
  document.getElementById("admin-user-ids").value = discord.adminUserIds.join("\n");
  document.getElementById("player-user-ids").value = discord.playerUserIds.join("\n");
}

function collectBindings() {
  return [...document.getElementById("binding-list").querySelectorAll(".binding-item")].map((item) => ({
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

async function saveLayout(state) {
  const data = await request("/admin/channel-layout", {
    method: "PUT",
    body: JSON.stringify({ bindings: collectBindings() })
  });
  state.channelLayout = data;
  renderBindings(state);
  log("Discord 版位設定已儲存");
}

async function saveAccessControl(url, body, successMessage, state) {
  const data = await request(url, { method: "PUT", body: JSON.stringify(body) });
  const accessControl = data?.accessControl || data;
  const syncReport = data?.syncReport;

  state.accessControl = accessControl;
  renderAccessControl(state);
  log(successMessage);

  if (syncReport) {
    log(
      `玩家資料同步：處理 ${syncReport.ensured} 人，新增玩家 ${syncReport.createdPlayers}、錢包 ${syncReport.createdWallets}、進度 ${syncReport.createdProgress}，略過 ${syncReport.skipped}（${syncReport.reason}）`
    );
  }
}
