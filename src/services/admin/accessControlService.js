const config = require("../../config");
const { PermissionsBitField } = require("discord.js");
const { AppError, ERROR_CODES } = require("../../shared/errors");

function uniq(items) {
  return [...new Set(items.map((x) => String(x).trim()).filter(Boolean))];
}

class AccessControlService {
  constructor(accessControlRepository, playerService) {
    this.accessControlRepository = accessControlRepository;
    this.playerService = playerService;
  }

  async syncAllowedPlayers() {
    if (!this.playerService) {
      return {
        ensured: 0,
        createdPlayers: 0,
        createdWallets: 0,
        createdProgress: 0,
        skipped: 0,
        reason: "player service not configured"
      };
    }

    const { getBotClient } = require("../../bot/runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      return {
        ensured: 0,
        createdPlayers: 0,
        createdWallets: 0,
        createdProgress: 0,
        skipped: 0,
        reason: "discord bot is not ready"
      };
    }

    if (!config.discord.guildId) {
      return {
        ensured: 0,
        createdPlayers: 0,
        createdWallets: 0,
        createdProgress: 0,
        skipped: 0,
        reason: "DISCORD_GUILD_ID is not configured"
      };
    }

    const access = await this.getAccessControl();
    const discord = access.discord;
    const allowedRoleIds = new Set([...discord.adminRoleIds, ...discord.playerRoleIds]);
    const allowedUserIds = new Set([...discord.adminUserIds, ...discord.playerUserIds]);
    const targets = new Map();
    const reasons = [];

    const guild = await client.guilds.fetch(config.discord.guildId);

    if (allowedRoleIds.size > 0) {
      try {
        await guild.members.fetch();

        for (const member of guild.members.cache.values()) {
          const byUser = allowedUserIds.has(member.user.id);
          const byRole = [...allowedRoleIds].some((roleId) => member.roles.cache.has(roleId));
          if (byUser || byRole) {
            targets.set(member.user.id, member.displayName || member.user.username || member.user.id);
          }
        }
      } catch (error) {
        reasons.push(
          error?.code === "GuildMembersTimeout"
            ? "role sync skipped: guild members fetch timed out"
            : "role sync skipped: enable Server Members Intent in Discord portal"
        );
      }
    }

    // 若有手動指定 userId 但目前不在快取成員中，仍嘗試建立玩家資料
    for (const userId of allowedUserIds) {
      if (targets.has(userId)) continue;
      try {
        const user = await client.users.fetch(userId);
        targets.set(userId, user?.username || userId);
      } catch (_error) {
        targets.set(userId, userId);
      }
    }

    let ensured = 0;
    let createdPlayers = 0;
    let createdWallets = 0;
    let createdProgress = 0;
    let skipped = 0;

    for (const [discordId, displayName] of targets.entries()) {
      try {
        const existingPlayer = await this.playerService.playerRepository.findByDiscordId(discordId);
        const existingWallet = await this.playerService.walletRepository.findByPlayerId(discordId);
        const existingProgress = await this.playerService.progressRepository.findByPlayerId(discordId);

        await this.playerService.ensurePlayer(discordId, displayName);
        ensured += 1;
        if (!existingPlayer) createdPlayers += 1;
        if (!existingWallet) createdWallets += 1;
        if (!existingProgress) createdProgress += 1;
      } catch (_error) {
        skipped += 1;
      }
    }

    return {
      ensured,
      createdPlayers,
      createdWallets,
      createdProgress,
      skipped,
      reason: reasons.length > 0 ? reasons.join("; ") : "ok"
    };
  }

  async getAccessControl() {
    const stored = await this.accessControlRepository.get();
    const discordStored = stored?.discord || {};
    const hasStored = (key) => Object.prototype.hasOwnProperty.call(discordStored, key);
    const storedAdminRoles = hasStored("adminRoleIds") ? discordStored.adminRoleIds : config.discord.adminRoleIds;
    const storedAdminUsers = hasStored("adminUserIds") ? discordStored.adminUserIds : config.discord.adminUserIds;
    const storedPlayerRoles = hasStored("playerRoleIds") ? discordStored.playerRoleIds : config.discord.playerRoleIds;
    const storedPlayerUsers = hasStored("playerUserIds") ? discordStored.playerUserIds : config.discord.playerUserIds;

    return {
      discord: {
        adminRoleIds: uniq(Array.isArray(storedAdminRoles) ? storedAdminRoles : []),
        adminUserIds: uniq(Array.isArray(storedAdminUsers) ? storedAdminUsers : []),
        playerRoleIds: uniq(Array.isArray(storedPlayerRoles) ? storedPlayerRoles : []),
        playerUserIds: uniq(Array.isArray(storedPlayerUsers) ? storedPlayerUsers : [])
      }
    };
  }

  async setDiscordRoleIds(adminRoleIds) {
    if (!Array.isArray(adminRoleIds)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "adminRoleIds must be an array", 400);
    }

    const stored = await this.accessControlRepository.get();
    const next = {
      ...stored,
      discord: {
        ...(stored.discord || {}),
        adminRoleIds: uniq(adminRoleIds)
      }
    };

    await this.accessControlRepository.save(next);
    return this.getAccessControl();
  }

  async setDiscordUserIds(adminUserIds) {
    if (!Array.isArray(adminUserIds)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "adminUserIds must be an array", 400);
    }

    const stored = await this.accessControlRepository.get();
    const next = {
      ...stored,
      discord: {
        ...(stored.discord || {}),
        adminUserIds: uniq(adminUserIds)
      }
    };

    await this.accessControlRepository.save(next);
    return this.getAccessControl();
  }

  async setDiscordPlayerRoleIds(playerRoleIds) {
    if (!Array.isArray(playerRoleIds)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "playerRoleIds must be an array", 400);
    }

    const stored = await this.accessControlRepository.get();
    const next = {
      ...stored,
      discord: {
        ...(stored.discord || {}),
        playerRoleIds: uniq(playerRoleIds)
      }
    };

    await this.accessControlRepository.save(next);
    return this.getAccessControl();
  }

  async setDiscordPlayerUserIds(playerUserIds) {
    if (!Array.isArray(playerUserIds)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "playerUserIds must be an array", 400);
    }

    const stored = await this.accessControlRepository.get();
    const next = {
      ...stored,
      discord: {
        ...(stored.discord || {}),
        playerUserIds: uniq(playerUserIds)
      }
    };

    await this.accessControlRepository.save(next);
    return this.getAccessControl();
  }

  async isDiscordAdmin(interaction) {
    const access = await this.getAccessControl();
    const roleIds = access.discord.adminRoleIds;
    const userIds = access.discord.adminUserIds;

    if (userIds.includes(interaction.user.id)) {
      return true;
    }

    const hasManageGuild = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
    if (!interaction.member || !interaction.member.roles) {
      return Boolean(hasManageGuild);
    }

    if (roleIds.length > 0) {
      const hasWhitelistedRole = roleIds.some((roleId) => interaction.member.roles.cache?.has(roleId));
      return Boolean(hasWhitelistedRole || hasManageGuild);
    }

    return Boolean(hasManageGuild);
  }

  async isDiscordPlayerAllowed(interaction) {
    if (await this.isDiscordAdmin(interaction)) {
      return true;
    }

    const access = await this.getAccessControl();
    const roleIds = access.discord.playerRoleIds;
    const userIds = access.discord.playerUserIds;

    if (userIds.includes(interaction.user.id)) {
      return true;
    }

    const hasAnyRestriction = roleIds.length > 0 || userIds.length > 0;
    if (!hasAnyRestriction) {
      return true;
    }

    if (!interaction.member || !interaction.member.roles) {
      return false;
    }

    return roleIds.some((roleId) => interaction.member.roles.cache?.has(roleId));
  }

  async isDiscordMemberWhitelisted(member) {
    const access = await this.getAccessControl();
    const adminRoleIds = access.discord.adminRoleIds;
    const adminUserIds = access.discord.adminUserIds;
    const playerRoleIds = access.discord.playerRoleIds;
    const playerUserIds = access.discord.playerUserIds;

    if (adminUserIds.includes(member.user.id) || playerUserIds.includes(member.user.id)) {
      return true;
    }

    const roleIds = [...new Set([...adminRoleIds, ...playerRoleIds])];
    if (roleIds.length === 0) {
      return false;
    }

    return roleIds.some((roleId) => member.roles.cache?.has(roleId));
  }

  async isDiscordPlayerWhitelisted(member) {
    if (!member?.user?.id) return false;

    const access = await this.getAccessControl();
    const playerRoleIds = access.discord.playerRoleIds;
    const playerUserIds = access.discord.playerUserIds;

    if (playerUserIds.includes(member.user.id)) {
      return true;
    }

    if (playerRoleIds.length === 0) {
      return false;
    }

    return playerRoleIds.some((roleId) => member.roles.cache?.has(roleId));
  }
}

module.exports = {
  AccessControlService
};
