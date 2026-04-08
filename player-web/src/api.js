// API Client for Web App
// 負責處理所有的後端通訊，包含自動夾帶 JWT Token

// 自動偵測 API 來源：優先使用環境變數，其次嘗試當前主機，最後預設 localhost
export const API_ORIGIN = import.meta.env.VITE_API_URL || 
                   (window.location.hostname !== 'localhost' ? `https://${window.location.hostname}` : 'http://localhost:5566');
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
  // 自動適應當前網址作為 Redirect URI
  const redirectUri = encodeURIComponent(`${window.location.protocol}//${window.location.host}/`);
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
      window.location.href = "/";
    }
    throw new Error(data.message || "API 請求失敗");
  }

  return data.data;
}

export const api = {
  // 驗證 Discord Code 取得 Token
  loginWithDiscord: (code) => fetchWithAuth("/auth/discord", {
    method: "POST",
    body: JSON.stringify({ code })
  }),

  // 取得玩家個人資料、數值、錢包
  getProfile: () => fetchWithAuth("/me/profile"),

  // 取得玩家背包
  getInventory: () => fetchWithAuth("/me/inventory"),

  // 道具操作
  useItem: (uuid) => fetchWithAuth(`/me/inventory/use/${uuid}`, { method: "POST" }),
  discardItem: (uuid) => fetchWithAuth(`/me/inventory/discard/${uuid}`, { method: "POST" }),
  equipItem: (uuid) => fetchWithAuth(`/me/inventory/equip/${uuid}`, { method: "POST" }),

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
  
  // 建立 Server-Sent Events 連線，不需要 token 因為是 GET，且後端未驗證
  createChatStream: (onMessage) => {
    const eventSource = new EventSource(`${API_BASE}/chat/stream`);
    eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };
    return eventSource;
  }
};
