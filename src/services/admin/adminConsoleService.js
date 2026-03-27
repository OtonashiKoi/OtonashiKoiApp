const { AppError, ERROR_CODES } = require("../../shared/errors");
const { createPlayerPanelMessage } = require("../../bot/playerPanelView");
const config = require("../../config");

const AVAILABLE_FEATURES = [
  {
    key: "player_panel",
    label: "玩家操作面板",
    description: "提供玩家建立、查詢、測試互動的聊天室按鈕面板"
  },
  {
    key: "player_query",
    label: "玩家資訊查詢",
    description: "管理員用來查詢玩家列表與詳細資料的版位"
  },
  {
    key: "admin_dashboard",
    label: "管理後台通知",
    description: "預留給管理後台同步與通知用頻道"
  },
  {
    key: "audit_log",
    label: "審計紀錄版位",
    description: "預留給管理審計或系統紀錄推送"
  }
];

function normalizeBinding(binding) {
  return {
    featureKey: String(binding.featureKey || "").trim(),
    channelId: String(binding.channelId || "").trim(),
    enabled: Boolean(binding.enabled),
    note: String(binding.note || "").trim()
  };
}

function validateBindings(bindings) {
  if (!Array.isArray(bindings)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "bindings must be an array", 400);
  }

  const normalized = bindings.map(normalizeBinding).filter((binding) => binding.featureKey);
  const seen = new Set();

  for (const binding of normalized) {
    if (!AVAILABLE_FEATURES.some((feature) => feature.key === binding.featureKey)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported featureKey: ${binding.featureKey}`, 400);
    }

    if (seen.has(binding.featureKey)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `duplicate featureKey: ${binding.featureKey}`, 400);
    }

    seen.add(binding.featureKey);
  }

  return normalized;
}

class AdminConsoleService {
  constructor(channelLayoutRepository, playerRepository, adminService) {
    this.channelLayoutRepository = channelLayoutRepository;
    this.playerRepository = playerRepository;
    this.adminService = adminService;
  }

  async getChannelLayout() {
    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings)
      ? stored.discord.bindings.map(normalizeBinding)
      : [];

    return {
      discord: {
        bindings,
        availableFeatures: AVAILABLE_FEATURES
      }
    };
  }

  async setChannelLayout(bindings) {
    const normalized = validateBindings(bindings);
    const next = {
      discord: {
        bindings: normalized
      }
    };

    await this.channelLayoutRepository.save(next);
    return this.getChannelLayout();
  }

  async listDiscordChannels() {
    const { getBotClient } = require("../../bot/runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Discord bot is not ready", 503);
    }

    if (!config.discord.guildId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "DISCORD_GUILD_ID is not configured", 503);
    }

    const guild = await client.guilds.fetch(config.discord.guildId);
    const channels = await guild.channels.fetch();

    return channels
      .filter((channel) => channel && channel.isTextBased && channel.isTextBased())
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId || ""
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hant"));
  }

  async listDiscordRoles() {
    const { getBotClient } = require("../../bot/runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Discord bot is not ready", 503);
    }

    if (!config.discord.guildId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "DISCORD_GUILD_ID is not configured", 503);
    }

    const guild = await client.guilds.fetch(config.discord.guildId);
    const roles = await guild.roles.fetch();

    return roles
      .filter((role) => role && role.id !== guild.id)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        position: role.position
      }))
      .sort((left, right) => right.position - left.position);
  }

  async publishPlayerPanel(channelId) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Discord bot is not ready", 503);
    }

    const targetChannelId = String(channelId || "").trim();
    if (!targetChannelId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "channelId is required", 400);
    }

    const channel = await client.channels.fetch(targetChannelId);
    if (!channel || !channel.isTextBased || !channel.isTextBased()) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "target channel is not text-based", 400);
    }

    const message = await channel.send(createPlayerPanelMessage());
    return {
      channelId: targetChannelId,
      messageId: message.id
    };
  }

  async listAllPlayers(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const players = await this.playerRepository.listAll();
    return players.slice(0, safeLimit);
  }

  async getPlayerQueryInfo(targetDiscordId) {
    if (!targetDiscordId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "targetDiscordId is required", 400);
    }

    return this.adminService.getPlayerSnapshot(targetDiscordId);
  }

  async publishPlayerQueryPanel(channelId) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { createPlayerQueryPanelMessage } = require("../../bot/playerQueryPanelView");

    const client = getBotClient();
    if (!client?.isReady()) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Discord bot is not ready", 503);
    }

    const targetChannelId = String(channelId || "").trim();
    if (!targetChannelId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "channelId is required", 400);
    }

    const channel = await client.channels.fetch(targetChannelId);
    if (!channel || !channel.isTextBased || !channel.isTextBased()) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "target channel is not text-based", 400);
    }

    const message = await channel.send(createPlayerQueryPanelMessage());
    return {
      channelId: targetChannelId,
      messageId: message.id
    };
  }
}

module.exports = {
  AdminConsoleService,
  AVAILABLE_FEATURES
};