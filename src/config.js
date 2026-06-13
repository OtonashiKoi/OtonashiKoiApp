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
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "", // Discord OAuth Client Secret
    guildId: process.env.DISCORD_GUILD_ID || "", // 伺服器 ID
    adminRoleIds: parseCsv(process.env.ADMIN_ROLE_IDS), // 管理員角色 ID 陣列
    adminUserIds: parseCsv(process.env.ADMIN_USER_IDS), // 管理員用戶 ID 陣列
    playerRoleIds: parseCsv(process.env.PLAYER_ROLE_IDS), // 玩家角色 ID 陣列
    playerUserIds: parseCsv(process.env.PLAYER_USER_IDS), // 玩家用戶 ID 陣列
    personalRoomChannelId: process.env.PERSONAL_ROOM_CHANNEL_ID || "", // 個人房間頻道 ID
    worldBossAlarmRoleId: process.env.WORLD_BOSS_ALARM_ROLE_ID || "1514513444899131424", // 世界王鬧鐘身分組 ID（個人房間按鈕訂閱＋開戰通知 TAG）
    pkArenaStartNoticeChannelId: process.env.PK_ARENA_START_NOTICE_CHANNEL_ID || "1498608950671839263", // PK 開戰通知頻道 ID
    pkArenaReportChannelId: process.env.PK_ARENA_REPORT_CHANNEL_ID || "1486423293044068392", // PK 戰報頻道 ID
    pkArenaForumChannelId: process.env.PK_ARENA_FORUM_CHANNEL_ID || "1501890000000913479", // PK 論壇戰報頻道 ID
    towerLobbyChannelId: process.env.TOWER_LOBBY_CHANNEL_ID || "1503635545832558632",   // 爬塔：面板大廳頻道 ID
    towerForumChannelId: process.env.TOWER_FORUM_CHANNEL_ID || "1503635643488796682",   // 爬塔：組隊攻略論壇 ID
    towerFloorBroadcastChannelId: process.env.TOWER_FLOOR_BROADCAST_CHANNEL_ID || "1498608950671839263", // 爬塔：每層通關廣播頻道 ID
    enhanceSuccessAnnounceChannelId: process.env.ENHANCE_SUCCESS_ANNOUNCE_CHANNEL_ID || "1450062298076151952", // 強化成功公告頻道 ID
    enhanceFailureAnnounceChannelId: process.env.ENHANCE_FAILURE_ANNOUNCE_CHANNEL_ID || "1450062298076151952", // 強化失敗公告頻道 ID
    welcomeAuditEnabled: process.env.ENABLE_WELCOME_AUDIT === "1" && process.env.DISABLE_WELCOME_AUDIT !== "1",
    welcomeAuditIntervalMs: Math.max(60_000, Number.parseInt(process.env.WELCOME_AUDIT_INTERVAL_MS || "1800000", 10) || 1_800_000),
    inviteUrl: process.env.DISCORD_INVITE_URL || "https://discord.gg/your-invite" // 預設 Discord 邀請連結
  },
  // API 伺服器設定
  api: {
    port: Number(process.env.API_PORT || 5566), // 監聽埠號
    adminPassword: process.env.ADMIN_PASSWORD || "admin123", // 管理後台密碼
    allowedOrigins: parseCsv(process.env.ALLOWED_ORIGINS), // CORS 允許的來源，逗號分隔
    publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || ""
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
  },
  // 直播會員 / 訂閱位階規則
  streamMembership: {
    adminUserIds: parseCsv(process.env.STREAM_ADMIN_USER_IDS || "865264891991425055"),
    youtubeChannel: process.env.STREAM_YOUTUBE_CHANNEL || "www.youtube.com/@音無恋",
    twitchChannel: process.env.STREAM_TWITCH_CHANNEL || "https://www.twitch.tv/otonashikoi",
    // 綁定碼引導網址：玩家拿到綁定碼後要去這個直播聊天室輸入 `!綁定 碼`
    bindYoutubeUrl: process.env.STREAM_BIND_YOUTUBE_URL || "https://www.youtube.com/watch?v=dwAGim_MnXw",
    youtubeTiers: {
      C: "鯉民",
      B: "鯉長",
      A: "鯉市長"
    },
    twitchTiers: {
      "1": "C",
      "2": "C",
      "3": "B"
    },
    noMembershipPolicy: "unchanged"
  },
  // 直播 OAuth / 即時會員查詢設定
  streamAuth: {
    stateSecret: process.env.STREAM_AUTH_SECRET || process.env.JWT_SECRET || "stream-auth-secret",
    twitchClientId: process.env.TWITCH_CLIENT_ID || "",
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    twitchBroadcasterId: process.env.TWITCH_BROADCASTER_ID || "",
    youtubeClientId: process.env.YOUTUBE_CLIENT_ID || "",
    youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    youtubeCreatorRefreshToken: process.env.STREAM_YOUTUBE_CREATOR_REFRESH_TOKEN || "",
    youtubeCreatorChannelId: process.env.STREAM_YOUTUBE_CREATOR_CHANNEL_ID || ""
  }
};
