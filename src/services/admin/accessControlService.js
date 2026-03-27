const config = require("../../config");
const { PermissionsBitField } = require("discord.js");
const { AppError, ERROR_CODES } = require("../../shared/errors");

function uniq(items) {
  return [...new Set(items.map((x) => String(x).trim()).filter(Boolean))];
}

class AccessControlService {
  constructor(accessControlRepository) {
    this.accessControlRepository = accessControlRepository;
  }

  async getAccessControl() {
    const stored = await this.accessControlRepository.get();
    const storedAdminRoles = stored?.discord?.adminRoleIds || [];
    const storedAdminUsers = stored?.discord?.adminUserIds || [];
    const storedPlayerRoles = stored?.discord?.playerRoleIds || [];
    const storedPlayerUsers = stored?.discord?.playerUserIds || [];

    return {
      discord: {
        adminRoleIds: uniq([...config.discord.adminRoleIds, ...storedAdminRoles]),
        adminUserIds: uniq([...config.discord.adminUserIds, ...storedAdminUsers]),
        playerRoleIds: uniq([...config.discord.playerRoleIds, ...storedPlayerRoles]),
        playerUserIds: uniq([...config.discord.playerUserIds, ...storedPlayerUsers])
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
}

module.exports = {
  AccessControlService
};