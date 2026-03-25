const { REST, Routes } = require("discord.js");
const config = require("../config");
const { definitions } = require("./commands");

async function registerCommands() {
  const { token, clientId, guildId } = config.discord;

  if (!token || !clientId || !guildId) {
    console.warn("[Discord] Missing DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID, skip command registration.");
    return false;
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: definitions
    });

    console.log(`[Discord] Slash commands registered to guild ${guildId}.`);
    return true;
  } catch (error) {
    console.error("[Discord] Failed to register slash commands.", error);
    return false;
  }
}

module.exports = {
  registerCommands
};
