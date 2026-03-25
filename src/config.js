const path = require("path");

module.exports = {
  port: Number(process.env.PORT || 5566),
  dataPath: path.resolve(process.env.DATA_PATH || "./data/game.json"),
  discord: {
    token: process.env.DISCORD_TOKEN || "",
    clientId: process.env.DISCORD_CLIENT_ID || "",
    guildId: process.env.DISCORD_GUILD_ID || ""
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || "",
    channelId: process.env.YOUTUBE_CHANNEL_ID || ""
  }
};
