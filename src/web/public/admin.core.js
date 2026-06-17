/* admin.core.js - core state and helpers (loaded before admin.ui.js) */
window.state = {
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

window.elements = {
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

window.elements.topRefresh = document.getElementById("top-refresh");

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${window.elements.adminPassword.value.trim()}`
  };

  return headers;
}

// 後台密碼不再自動儲存:只存在當前頁面記憶體,重新整理/重開就要再輸入。
// 同時清掉先前可能已存在 localStorage 的明碼,避免殘留。
function saveAuth() {
  try { localStorage.removeItem("admin-password"); } catch (_) { /* noop */ }
}

function loadAuth() {
  try { localStorage.removeItem("admin-password"); } catch (_) { /* noop */ }
  // 不自動帶入密碼,維持空白
}

function log(message) {
  const stamp = new Date().toLocaleString("zh-TW", { hour12: false });
  window.elements.activityLog.textContent = `[${stamp}] ${message}\n${window.elements.activityLog.textContent}`.trim();
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
  window.elements.playerDetail.classList.toggle("hidden", hasSelection);
  window.elements.playerDetailView.classList.toggle("hidden", !hasSelection);
}

function setPlayerActionEnabled(enabled) {
  window.elements.currencyTypeInput.disabled = !enabled;
  window.elements.currencyOperationInput.disabled = !enabled;
  window.elements.currencyAmountInput.disabled = !enabled;
  window.elements.currencyReasonInput.disabled = !enabled;
  window.elements.currencySubmitButton.disabled = !enabled;
  window.elements.expAmountInput.disabled = !enabled;
  window.elements.expReasonInput.disabled = !enabled;
  window.elements.expSubmitButton.disabled = !enabled;
}

function showSection(targetId) {
  for (const section of window.elements.sections) {
    section.classList.toggle("active", section.id === targetId);
  }

  let activeLink = null;
  for (const link of window.elements.navLinks) {
    const isActive = link.dataset.target === targetId;
    link.classList.toggle("active", isActive);
    if (isActive) activeLink = link;
  }

  if (activeLink) {
    const parentGroup = activeLink.closest(".nav-group");
    if (parentGroup) {
      parentGroup.classList.add("is-open");
      const toggle = parentGroup.querySelector(".nav-group-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    }
  }
}

function buildGroupedItemOptionsHtml(items = [], {
  selectedId = "",
  includePlaceholder = false,
  placeholderText = "請選擇道具"
} = {}) {
  const slotLabels = {
    weapon: "武器", shield: "副手", armor: "衣服", garment: "披肩", shoes: "鞋子",
    head_top: "頭上", head_mid: "頭中", head_low: "頭下",
    accessory_l: "飾品左", accessory_r: "飾品右",
    title_eq: "稱號", job_eq: "職業", special_1: "特殊1", special_2: "特殊2", special_3: "特殊3"
  };
  const isSpecialEquipment = (item) => {
    if (item?.itemType !== "equipment") return false;
    return ["title_eq", "job_eq", "special_1", "special_2", "special_3"].includes(item.equipSlot);
  };
  const groups = {
    equipment: [],
    special: [],
    consumable: [],
    collectible: []
  };
  for (const item of (Array.isArray(items) ? items : [])) {
    if (item.itemType === "equipment") {
      if (isSpecialEquipment(item)) groups.special.push(item);
      else groups.equipment.push(item);
    } else if (item.itemType === "consumable") {
      groups.consumable.push(item);
    } else {
      groups.collectible.push(item);
    }
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  const toOptions = (arr, icon) => arr.map((item) => {
    const slotText = item.equipSlot ? ` [${slotLabels[item.equipSlot] || item.equipSlot}]` : "";
    const selected = item.id === selectedId ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${selected}>${icon} ${escapeHtml(item.name)}${slotText}</option>`;
  }).join("");

  const groupsHtml = [
    groups.equipment.length ? `<optgroup label="一般裝備">${toOptions(groups.equipment, "⚔️")}</optgroup>` : "",
    groups.special.length ? `<optgroup label="特殊裝備 / 稱號 / 職業">${toOptions(groups.special, "🏷️")}</optgroup>` : "",
    groups.consumable.length ? `<optgroup label="消耗品">${toOptions(groups.consumable, "🧪")}</optgroup>` : "",
    groups.collectible.length ? `<optgroup label="收藏品">${toOptions(groups.collectible, "🖼️")}</optgroup>` : ""
  ].join("");

  const head = includePlaceholder ? `<option value="">${escapeHtml(placeholderText)}</option>` : "";
  return head + groupsHtml;
}

let itemPickerModal = null;
let itemPickerItemsCache = null;
let playerPickerModal = null;
let playerPickerCache = null;

function classifyItemBucket(item) {
  if (item?.itemType === "equipment") {
    if (["title_eq", "job_eq", "special_1", "special_2", "special_3"].includes(item.equipSlot)) return "special";
    return "equipment";
  }
  if (item?.itemType === "consumable") return "consumable";
  return "collectible";
}

function slotDisplayName(slot) {
  const map = {
    weapon: "武器", shield: "副手", armor: "衣服", garment: "披肩", shoes: "鞋子",
    head_top: "頭上", head_mid: "頭中", head_low: "頭下",
    accessory_l: "飾品左", accessory_r: "飾品右",
    title_eq: "稱號", job_eq: "職業", special_1: "特殊1", special_2: "特殊2", special_3: "特殊3"
  };
  return map[slot] || slot || "";
}

async function getItemPickerItems(force = false) {
  if (!force && Array.isArray(itemPickerItemsCache)) return itemPickerItemsCache;
  const items = await request("/admin/items");
  itemPickerItemsCache = Array.isArray(items) ? items : [];
  return itemPickerItemsCache;
}

function ensureItemPickerModal() {
  if (itemPickerModal) return itemPickerModal;
  const modal = document.createElement("div");
  modal.className = "item-picker-modal";
  modal.style.display = "none";
  modal.innerHTML = `
    <div class="item-picker-sheet">
      <div class="item-picker-head">
        <strong data-role="title">選擇道具</strong>
        <button class="button" type="button" data-role="close">關閉</button>
      </div>
      <div class="item-picker-tools">
        <input class="sheet-input" type="text" data-role="search" placeholder="搜尋名稱 / ID..." />
        <select class="sheet-input" data-role="category">
          <option value="all">全部分類</option>
          <option value="equipment">一般裝備</option>
          <option value="special">特殊裝備 / 稱號 / 職業</option>
          <option value="consumable">消耗品</option>
          <option value="collectible">收藏品</option>
        </select>
        <select class="sheet-input" data-role="tier">
          <option value="all">全部品級</option>
          <option value="D">D</option>
          <option value="C">C</option>
          <option value="B">B</option>
          <option value="A">A</option>
          <option value="S">S</option>
        </select>
      </div>
      <div class="item-picker-grid" data-role="grid"></div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.dataset.role === "close") {
      modal.style.display = "none";
      modal._onPick = null;
    }
  });
  document.body.appendChild(modal);
  itemPickerModal = modal;
  return modal;
}

function renderItemPickerGrid(modal, items, selectedId) {
  const q = (modal.querySelector('[data-role="search"]')?.value || "").trim().toLowerCase();
  const category = modal.querySelector('[data-role="category"]')?.value || "all";
  const tier = modal.querySelector('[data-role="tier"]')?.value || "all";
  const grid = modal.querySelector('[data-role="grid"]');
  if (!grid) return;

  const filtered = (Array.isArray(items) ? items : []).filter((item) => {
    const bucket = classifyItemBucket(item);
    if (category !== "all" && bucket !== category) return false;
    if (tier !== "all" && String(item.tier || "") !== tier) return false;
    if (!q) return true;
    const haystack = `${item.name || ""} ${item.id || ""} ${item.description || ""}`.toLowerCase();
    return haystack.includes(q);
  });

  if (!filtered.length) {
    grid.innerHTML = `<p class="hint" style="margin:0;">沒有符合條件的道具</p>`;
    return;
  }

  grid.innerHTML = filtered.map((item) => {
    const bucket = classifyItemBucket(item);
    const slotText = item.equipSlot ? ` / ${slotDisplayName(item.equipSlot)}` : "";
    const tierText = item.tier ? ` / ${item.tier}` : "";
    const thumb = item.imageThumbnailUrl || item.imageUrl || "";
    const active = item.id === selectedId ? " is-active" : "";
    const typeLabel = bucket === "special" ? "特殊裝備" : bucket === "equipment" ? "裝備" : bucket === "consumable" ? "消耗品" : "收藏品";
    return `
      <button type="button" class="item-picker-card${active}" data-role="pick" data-id="${escapeHtml(item.id)}">
        <div class="item-picker-thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="">` : `<span>無圖</span>`}</div>
        <div class="item-picker-meta">
          <strong>${escapeHtml(item.name || "未命名道具")}</strong>
          <div class="hint">${escapeHtml(typeLabel)}${escapeHtml(slotText)}${escapeHtml(tierText)}</div>
          <div class="hint">${escapeHtml(item.id || "")}</div>
        </div>
      </button>
    `;
  }).join("");

  grid.querySelectorAll('[data-role="pick"]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const picked = items.find((item) => item.id === id) || null;
      if (modal._onPick) modal._onPick(picked);
      modal.style.display = "none";
      modal._onPick = null;
    };
  });
}

async function openItemPicker({
  title = "選擇道具",
  selectedId = "",
  onPick = null
} = {}) {
  const modal = ensureItemPickerModal();
  const items = await getItemPickerItems();
  modal.querySelector('[data-role="title"]').textContent = title;
  modal._onPick = onPick;
  modal.style.display = "flex";
  const search = modal.querySelector('[data-role="search"]');
  const category = modal.querySelector('[data-role="category"]');
  const tier = modal.querySelector('[data-role="tier"]');
  if (search) search.value = "";
  if (category) category.value = "all";
  if (tier) tier.value = "all";
  const rerender = () => renderItemPickerGrid(modal, items, selectedId);
  if (search) search.oninput = rerender;
  if (category) category.onchange = rerender;
  if (tier) tier.onchange = rerender;
  rerender();
}

async function getPlayerPickerPlayers(force = false) {
  if (!force && Array.isArray(playerPickerCache)) return playerPickerCache;
  const players = await request("/admin/console/players?limit=1000");
  playerPickerCache = Array.isArray(players) ? players : [];
  return playerPickerCache;
}

function ensurePlayerPickerModal() {
  if (playerPickerModal) return playerPickerModal;
  const modal = document.createElement("div");
  modal.className = "item-picker-modal";
  modal.style.display = "none";
  modal.innerHTML = `
    <div class="item-picker-sheet">
      <div class="item-picker-head">
        <strong data-role="title">選擇玩家</strong>
        <button class="button" type="button" data-role="close">關閉</button>
      </div>
      <div class="item-picker-tools">
        <input class="sheet-input" type="text" data-role="search" placeholder="搜尋玩家名稱 / Discord ID..." />
        <select class="sheet-input" data-role="tier"><option value="all">全部 Tier</option></select>
        <select class="sheet-input" data-role="status">
          <option value="all">全部狀態</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
          <option value="banned">banned</option>
        </select>
      </div>
      <div class="item-picker-grid" data-role="grid"></div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.dataset.role === "close") {
      modal.style.display = "none";
      modal._onPick = null;
    }
  });
  document.body.appendChild(modal);
  playerPickerModal = modal;
  return modal;
}

function renderPlayerPickerGrid(modal, players, selectedId) {
  const q = (modal.querySelector('[data-role="search"]')?.value || "").trim().toLowerCase();
  const tier = modal.querySelector('[data-role="tier"]')?.value || "all";
  const status = modal.querySelector('[data-role="status"]')?.value || "all";
  const grid = modal.querySelector('[data-role="grid"]');
  if (!grid) return;

  const filtered = (Array.isArray(players) ? players : []).filter((player) => {
    const pTier = String(player?.playerTier || "").toUpperCase();
    const pStatus = String(player?.status || "").toLowerCase();
    if (tier !== "all" && pTier !== tier) return false;
    if (status !== "all" && pStatus !== status) return false;
    if (!q) return true;
    const haystack = `${player?.displayName || ""} ${player?.discordId || ""}`.toLowerCase();
    return haystack.includes(q);
  });

  if (!filtered.length) {
    grid.innerHTML = `<p class="hint" style="margin:0;">沒有符合條件的玩家</p>`;
    return;
  }

  grid.innerHTML = filtered.map((player) => {
    const id = player?.discordId || "";
    const name = player?.displayName || "Unknown";
    const initials = escapeHtml((name.trim().charAt(0) || "?").toUpperCase());
    const active = id === selectedId ? " is-active" : "";
    return `
      <button type="button" class="item-picker-card${active}" data-role="pick" data-id="${escapeHtml(id)}">
        <div class="item-picker-thumb"><span>${initials}</span></div>
        <div class="item-picker-meta">
          <strong>${escapeHtml(name)}</strong>
          <div class="hint">Tier ${escapeHtml(String(player?.playerTier || "-"))} / ${escapeHtml(String(player?.status || "-"))}</div>
          <div class="hint">${escapeHtml(id)}</div>
        </div>
      </button>
    `;
  }).join("");

  grid.querySelectorAll('[data-role="pick"]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const picked = players.find((player) => player.discordId === id) || null;
      if (modal._onPick) modal._onPick(picked);
      modal.style.display = "none";
      modal._onPick = null;
    };
  });
}

async function openPlayerPicker({
  title = "選擇玩家",
  selectedId = "",
  onPick = null
} = {}) {
  const modal = ensurePlayerPickerModal();
  const players = await getPlayerPickerPlayers();
  const tierSet = new Set(players.map((player) => String(player?.playerTier || "").toUpperCase()).filter(Boolean));
  const tierSelect = modal.querySelector('[data-role="tier"]');
  if (tierSelect) {
    tierSelect.innerHTML = `<option value="all">全部 Tier</option>` + [...tierSet].sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }
  modal.querySelector('[data-role="title"]').textContent = title;
  modal._onPick = onPick;
  modal.style.display = "flex";
  const search = modal.querySelector('[data-role="search"]');
  const status = modal.querySelector('[data-role="status"]');
  if (search) search.value = "";
  if (tierSelect) tierSelect.value = "all";
  if (status) status.value = "all";
  const rerender = () => renderPlayerPickerGrid(modal, players, selectedId);
  if (search) search.oninput = rerender;
  if (tierSelect) tierSelect.onchange = rerender;
  if (status) status.onchange = rerender;
  rerender();
}

// expose helpers globally
window.adminCore = {
  getHeaders,
  saveAuth,
  loadAuth,
  log,
  request,
  splitLines,
  escapeHtml,
  formatDateTime,
  buildGroupedItemOptionsHtml,
  getItemPickerItems,
  openItemPicker,
  getPlayerPickerPlayers,
  openPlayerPicker,
  togglePlayerDetail,
  setPlayerActionEnabled,
  showSection
};

window.getAdminToken = () => window.elements.adminPassword.value.trim();
window.logActivity = (msg) => log(msg);
