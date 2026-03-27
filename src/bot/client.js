const { Client, GatewayIntentBits, Events, MessageFlags } = require("discord.js");
const config = require("../config");
const { isAppError } = require("../shared/errors");
const { handleCommand, handleButton, handleModal } = require("./commands");
const { setBotClient } = require("./runtimeContext");

function createBotClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  setBotClient(client);

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction);
        return;
      }
    } catch (error) {
      console.error("[Discord] command error", error);
      const message = isAppError(error) ? `❌ ${error.message}` : "發生錯誤，請稍後再試。";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: message,
          flags: MessageFlags.Ephemeral 
        });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral 
        });
      }
    }
  });

  return client;
}

async function loginBot(client) {
  if (!config.discord.token) {
    console.warn("[Discord] DISCORD_TOKEN not set; bot login skipped.");
    return;
  }
  await client.login(config.discord.token);
}

module.exports = {
  createBotClient,
  loginBot
};
