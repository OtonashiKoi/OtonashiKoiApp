const { Client, GatewayIntentBits, Events, MessageFlags } = require("discord.js");
const config = require("../config");
const { isAppError } = require("../shared/errors");
const { handleCommand, handleButton, handleModal } = require("./commands");
const { serviceContext, setBotClient } = require("./runtimeContext");

async function ensureMemberPlayerProfile(member, reason) {
  try {
    const allowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(member);
    if (!allowed) {
      return;
    }

    const existing = await serviceContext.playerService.playerRepository.findByDiscordId(member.user.id);
    await serviceContext.playerService.ensurePlayer(
      member.user.id,
      member.displayName || member.user.globalName || member.user.username || member.user.id
    );

    if (!existing) {
      console.log(`[Discord] auto-provisioned player ${member.user.id} (${member.displayName}) via ${reason}`);
    }
  } catch (error) {
    console.error(`[Discord] auto-provision failed for ${member?.user?.id || "unknown"}`, error);
  }
}

function createBotClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
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

  client.on(Events.GuildMemberAdd, async (member) => {
    await ensureMemberPlayerProfile(member, "guild-member-add");
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const wasAllowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(oldMember);
    const isAllowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(newMember);
    if (!wasAllowed && isAllowed) {
      await ensureMemberPlayerProfile(newMember, "guild-member-update");
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
