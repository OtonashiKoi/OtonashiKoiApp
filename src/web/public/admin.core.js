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

function saveAuth() {
  localStorage.setItem("admin-password", window.elements.adminPassword.value);
}

function loadAuth() {
  window.elements.adminPassword.value = localStorage.getItem("admin-password") || "";
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
  togglePlayerDetail,
  setPlayerActionEnabled,
  showSection
};

window.getAdminToken = () => window.elements.adminPassword.value.trim();
window.logActivity = (msg) => log(msg);
