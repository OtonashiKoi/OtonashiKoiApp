import remoteConfig from './config.json';

// 自動偵測 API 來源：localhost 優先走本機，否則依序讀環境變數 / config.json
export const API_ORIGIN = window.location.hostname === 'localhost'
  ? 'http://localhost:5566'
  : (import.meta.env.VITE_API_URL || remoteConfig.remoteApiUrl || `https://${window.location.hostname}`);
const API_BASE = `${API_ORIGIN}/api`;

function getToken() {
  return localStorage.getItem("player_token");
}

export function setToken(token) {
  if (token) localStorage.setItem("player_token", token);
  else localStorage.removeItem("player_token");
}

export function getDiscordLoginUrl() {
  const clientId = "1450019975031951370";
  // 自動適應當前網址作為 Redirect URI (支援 GitHub Pages 子路徑)
  const redirectUri = encodeURIComponent(`${window.location.origin}${window.location.pathname}`);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
}

async function fetchWithAuth(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  if (!response.ok || data.status !== "ok") {
    if (response.status === 401) {
      setToken(null);
      window.location.href = import.meta.env.BASE_URL || '/';
    }
    const err = new Error(data.message || "API 請求失敗");
    err.code = data.code || null;
    throw err;
  }

  return data.data;
}

export const api = {
  // 驗證 Discord Code 取得 Token（redirect_uri 必須與 OAuth 發起時一致）
  loginWithDiscord: (code) => fetchWithAuth("/auth/discord", {
    method: "POST",
    body: JSON.stringify({
      code,
      redirect_uri: `${window.location.origin}${window.location.pathname}`
    })
  }),

  // 取得玩家個人資料、數值、錢包
  getProfile: () => fetchWithAuth("/me/profile"),

  // 取得玩家背包
  getInventory: () => fetchWithAuth("/me/inventory"),

  // 道具操作
  useItem: (uuid) => fetchWithAuth(`/me/inventory/use/${uuid}`, { method: "POST" }),
  discardItem: (uuid) => fetchWithAuth(`/me/inventory/discard/${uuid}`, { method: "POST" }),
  equipItem: (uuid) => fetchWithAuth(`/me/inventory/equip/${uuid}`, { method: "POST" }),
  unequipItem: (slotKey) => fetchWithAuth(`/me/inventory/unequip/${slotKey}`, { method: "POST" }),

  // 強化裝備：targetUuid（目標） + materialUuid（材料）
  enhanceItem: (targetUuid, materialUuid) => fetchWithAuth(`/me/inventory/enhance`, {
    method: "POST",
    body: JSON.stringify({ targetUuid, materialUuid })
  }),

  // ===== 商城系統 =====
  getShopItems: () => fetchWithAuth("/shop/items"),
  buyShopItem: (itemId) => fetchWithAuth(`/shop/buy/${itemId}`, { method: "POST" }),

  // ===== 戰鬥系統 =====
  getCombatZones: () => fetchWithAuth("/combat/zones"),
  quickBattle: (zone) => fetchWithAuth("/combat/quick-battle", {
    method: "POST",
    body: JSON.stringify({ zone })
  }),

  // ===== 大廳聊天系統 =====
  sendChatMessage: (message) => fetchWithAuth("/chat/lobby", {
    method: "POST",
    body: JSON.stringify({ message })
  }),
  getChatHistory: () => fetchWithAuth("/chat/history"),
  getChatExpressions: () => fetchWithAuth("/chat/expressions"),
  
  // ===== 每週任務 =====
  getWeeklyQuests: () => fetchWithAuth("/weekly-quests"),
  claimWeeklyReward: (id) => fetchWithAuth(`/weekly-quests/${id}/claim`, { method: "POST" }),
  pollNotifications: () => fetchWithAuth("/notifications/poll"),

  // 建立 Server-Sent Events 連線（EventSource 不支援 Header，以 query param 傳 token）
  createChatStream: (onMessage, { onReward } = {}) => {
    const token = getToken();
    const url = token
      ? `${API_BASE}/chat/stream?token=${encodeURIComponent(token)}`
      : `${API_BASE}/chat/stream`;
    const eventSource = new EventSource(url);
    eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };
    if (onReward) {
      eventSource.addEventListener('reward', (event) => {
        try {
          const summary = JSON.parse(event.data);
          onReward(summary);
        } catch (err) {
          console.error("SSE reward parse error", err);
        }
      });
    }
    return eventSource;
  }
};
