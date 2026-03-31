// 全域設定檔，統一管理各種環境變數與系統參數
// ------------------------------------------------

const path = require("path");

// 將逗號分隔字串轉為陣列，常用於多個 ID 設定
function parseCsv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// 匯出所有設定，包含 Discord、API、儲存、工程參數
module.exports = {
  // Discord 相關設定
  discord: {
    token: process.env.DISCORD_TOKEN || "", // Bot Token
    clientId: process.env.DISCORD_CLIENT_ID || "", // Bot 應用程式 ID
    guildId: process.env.DISCORD_GUILD_ID || "", // 伺服器 ID
    adminRoleIds: parseCsv(process.env.ADMIN_ROLE_IDS), // 管理員角色 ID 陣列
    adminUserIds: parseCsv(process.env.ADMIN_USER_IDS), // 管理員用戶 ID 陣列
    playerRoleIds: parseCsv(process.env.PLAYER_ROLE_IDS), // 玩家角色 ID 陣列
    playerUserIds: parseCsv(process.env.PLAYER_USER_IDS), // 玩家用戶 ID 陣列
    personalRoomChannelId: process.env.PERSONAL_ROOM_CHANNEL_ID || "" // 個人房間頻道 ID
  },
  // API 伺服器設定
  api: {
    port: Number(process.env.API_PORT || 5566), // 監聽埠號
    adminPassword: process.env.ADMIN_PASSWORD || "admin123" // 管理後台密碼
  },
  // 資料儲存設定
  storage: {
    driver: process.env.STORAGE_DRIVER || "json", // 儲存驅動（json 或 mongo）
    jsonDataPath: path.resolve(process.env.JSON_DATA_PATH || "./data/game.json"), // JSON 檔案路徑
    mongoUri: process.env.MONGODB_URI || "", // MongoDB 連線字串
    mongoDbName: process.env.MONGODB_DB_NAME || "equipment_game" // MongoDB 資料庫名稱
  },
  // 工程參數（如程式碼行數警告）
  engineering: {
    lineWarning: 320, // 行數警告門檻
    lineHardLimit: 400 // 行數硬限制
  }
};
