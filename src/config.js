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
    personalRoomChannelId: process.env.PERSONAL_ROOM_CHANNEL_ID || "", // 個人房間頻道 ID
    inviteUrl: process.env.DISCORD_INVITE_URL || "https://discord.gg/your-invite" // 預設 Discord 邀請連結
  },
  // API 伺服器設定
  api: {
    port: Number(process.env.API_PORT || 5566), // 監聽埠號
    adminPassword: process.env.ADMIN_PASSWORD || "admin123", // 管理後台密碼
    allowedOrigins: parseCsv(process.env.ALLOWED_ORIGINS) // CORS 允許的來源，逗號分隔
  },
  // 資料儲存設定
  storage: {
    mongoUri: process.env.MONGODB_URI || "", // MongoDB 連線字串
    mongoDbName: process.env.MONGODB_DB_NAME || "equipment_game" // MongoDB 資料庫名稱
    , jsonDataPath: process.env.JSON_DATA_PATH || path.resolve(__dirname, '..', 'data', 'monsters-db-merged.json')
  },
  // 工程參數（如程式碼行數警告）
  engineering: {
    lineWarning: 320, // 行數警告門檻
    lineHardLimit: 400 // 行數硬限制
  }
  ,
  // Moderation / SpamGuard 設定（可由 .env 調整）
  moderation: {
    muteDurationMs: Number(process.env.MOD_MUTE_MS || 12 * 60 * 60 * 1000),
    sameMsgLimit: Number(process.env.SAME_MSG_LIMIT || 4),
    burstLimit: Number(process.env.BURST_LIMIT || 6),
    burstWindowMs: Number(process.env.BURST_WINDOW_MS || 3000),
    spamAnnounceChannelId: process.env.SPAM_ANNOUNCE_CHANNEL_ID || "1292448143946027039",
    // attachments 檢查已取消（不新增 ATTACHMENT_LIMIT）
    mentionPerMsgLimit: Number(process.env.MENTION_PER_MSG_LIMIT || 5),
    consecutiveMentionLimit: Number(process.env.CONSECUTIVE_MENTION_LIMIT || 4)
  },
  // 遊戲參數（可微調）
  game: {
    // 預期同時與怪物戰鬥的玩家數（用於調整怪物血量規模）
    monsterExpectedPlayers: Number(process.env.MONSTER_EXPECTED_PLAYERS || 6)
  }
};
