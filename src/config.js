const path = require("path");

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN || "",
    clientId: process.env.DISCORD_CLIENT_ID || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
    adminRoleIds: parseCsv(process.env.ADMIN_ROLE_IDS),
    adminUserIds: parseCsv(process.env.ADMIN_USER_IDS),
    playerRoleIds: parseCsv(process.env.PLAYER_ROLE_IDS),
    playerUserIds: parseCsv(process.env.PLAYER_USER_IDS),
    personalRoomChannelId: process.env.PERSONAL_ROOM_CHANNEL_ID || ""
  },
  api: {
    port: Number(process.env.API_PORT || 5566),
    adminPassword: process.env.ADMIN_PASSWORD || "admin123"
  },
  storage: {
    driver: process.env.STORAGE_DRIVER || "json",
    jsonDataPath: path.resolve(process.env.JSON_DATA_PATH || "./data/game.json"),
    mongoUri: process.env.MONGODB_URI || "",
    mongoDbName: process.env.MONGODB_DB_NAME || "equipment_game"
  },
  engineering: {
    lineWarning: 320,
    lineHardLimit: 400
  }
};
