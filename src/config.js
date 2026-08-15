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
const config = {
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
    inviteUrl: process.env.DISCORD_INVITE_URL || "https://discord.com/invite/EfpECVDJF6" // 預設 Discord 邀請連結
  },
  // API 伺服器設定
  api: {
    port: Number(process.env.API_PORT || 5566), // 監聽埠號
    adminPassword: process.env.ADMIN_PASSWORD || "admin123", // 管理後台密碼
    jwtSecret: process.env.JWT_SECRET, // JWT 簽章密鑰(集中來源)
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
    lineHardLimit: 400, // 新檔案硬限制
    // 舊大型檔案採棘輪基準：允許小幅功能成長，但不能無限制膨脹。
    // 實際額度取固定行數與百分比兩者較大值。
    legacyLineGrowthAllowance: 50,
    legacyLineGrowthPercent: 2
  }
  ,
  // Moderation / SpamGuard 設定（可由 .env 調整）
  moderation: {
    muteDurationMs: Number(process.env.MOD_MUTE_MS || 12 * 60 * 60 * 1000),
    sameMsgLimit: Number(process.env.SAME_MSG_LIMIT || 3),
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
    // 安全：不再用已公開的弱預設字串當簽章密鑰；缺 secret 時留空→JWT 驗證會失敗(fail-loud)而非用可預測密鑰
    stateSecret: process.env.STREAM_AUTH_SECRET || process.env.JWT_SECRET || "",
    twitchClientId: process.env.TWITCH_CLIENT_ID || "",
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    twitchBroadcasterId: process.env.TWITCH_BROADCASTER_ID || "",
    youtubeClientId: process.env.YOUTUBE_CLIENT_ID || "",
    youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    // YouTube Google OAuth 直連綁定先只對測試帳號顯示／放行；逗號分隔。
    youtubeDirectBindTestDiscordIds: parseCsv(
      process.env.YOUTUBE_DIRECT_BIND_TEST_DISCORD_IDS || "865264891991425055"
    ),
    youtubeCreatorRefreshToken: process.env.STREAM_YOUTUBE_CREATOR_REFRESH_TOKEN || "",
    youtubeCreatorChannelId: process.env.STREAM_YOUTUBE_CREATOR_CHANNEL_ID || ""
  },
  // 綠界「直播主收款」金流：ReturnURL 收單 → 依留言斗內碼發鑽
  //   測試特店(綠界官方 stage)：MerchantID 3002607 / HashKey pwFHCqoQZGmho4w6 / HashIV EkRm7iFT261dpevs
  //   正式上線請在 .env 覆蓋為你自己的特店資料，並把 ECPAY_AUTO_GRANT 設 true。
  ecpay: {
    enabled: String(process.env.ECPAY_ENABLED || "true") !== "false",
    merchantId: process.env.ECPAY_MERCHANT_ID || "3002607",
    hashKey: process.env.ECPAY_HASH_KEY || "pwFHCqoQZGmho4w6",
    hashIV: process.env.ECPAY_HASH_IV || "EkRm7iFT261dpevs",
    // 驗簽通過後是否自動發鑽。預設 false：因為沙盒 HashKey/HashIV 是公開的，
    // 若在正式站以公開沙盒金鑰自動發鑽，任何人都能偽造合法簽章換免費鑽。
    // 請在 .env 填入「你自己的正式特店金鑰」後，再設 ECPAY_AUTO_GRANT=true。
    autoGrant: String(process.env.ECPAY_AUTO_GRANT || "false") === "true",
    // 綠界斗內是否同樣觸發全服 Buff / SC 累積條（與 YouTube SC 同待遇）
    triggerStreamEvents: String(process.env.ECPAY_TRIGGER_STREAM_EVENTS || "true") !== "false",
    // 每 N 元台幣兌 1 鑽（與 SC 斗內同口徑）
    twdPerDiamond: Number(process.env.ECPAY_TWD_PER_DIAMOND || 100),
    // 綠界後台產生的「直播主收款」收款網址；填了前端才顯示「前往斗內」按鈕
    donateUrl: process.env.ECPAY_DONATE_URL || ""
  }
};

// 啟動時安全檢查:正式環境(NODE_ENV=production)若關鍵密鑰未設或仍是程式內弱預設值 →
// 直接中止啟動,避免用「公開在原始碼的預設密鑰」上線(可被自簽 token 冒充玩家 / admin123 接管後台)。
// 開發環境僅警告,不擋。
config.assertSecureConfig = function assertSecureConfig() {
  const isProd = process.env.NODE_ENV === "production";
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "super-secret-jwt-key") {
    problems.push("JWT_SECRET 未設或仍是預設值");
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "admin123") {
    problems.push("ADMIN_PASSWORD 未設或仍是預設值 admin123");
  }
  if (problems.length) {
    const msg = "[安全設定] " + problems.join("；");
    if (isProd) {
      throw new Error(msg + " — 正式環境拒絕以弱預設密鑰啟動,請在 .env 設定強隨機值。");
    }
    console.warn("⚠️  " + msg + "(開發環境僅警告)");
  }
};

module.exports = config;
