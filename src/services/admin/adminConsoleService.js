const { AppError, ERROR_CODES } = require("../../shared/errors");
const { createPlayerPanelMessage } = require("../../bot/playerPanelView");
const config = require("../../config");

const AVAILABLE_FEATURES = [
  {
    key: "park_announcement",
    label: "樂園公告面板",
    description: "遊戲公告與活動資訊"
  },
  {
    key: "town_chat",
    label: "聊天大街面板",
    description: "玩家聊天室與社群互動"
  },
  {
    key: "daily_quest",
    label: "每日挑戰任務面板",
    description: "每日任務與挑戰入口"
  },
  {
    key: "coin_shop",
    label: "金幣商店面板",
    description: "商店與資源兌換功能"
  },
  {
    key: "personal_room",
    label: "個人房間面板",
    description: "玩家個人化功能與私人操作"
  },
  {
    key: "monster_zone",
    label: "放怪區面板",
    description: "玩家在此頻道選擇出戰並進行回合制戰鬥"
  }
];

function normalizeBinding(binding) {
  const visibleTo = binding?.visibleTo && typeof binding.visibleTo === "object" ? binding.visibleTo : {};

  return {
    featureKey: String(binding.featureKey || "").trim(),
    channelId: String(binding.channelId || "").trim(),
    enabled: Boolean(binding.enabled),
    note: String(binding.note || "").trim(),
    panelMessageId: String(binding.panelMessageId || "").trim(),
    visibleTo: {
      player: visibleTo.player !== false,
      admin: visibleTo.admin !== false
    }
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

    // 刪除舊面板訊息（如果有記錄的話）
    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const existingBinding = bindings.find((b) => b.featureKey === "personal_room");
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {}); // 訊息已被刪除或不存在時忽略
    }

    // 發送新面板
    const message = await channel.send(createPlayerPanelMessage());

    // 把新 messageId 寫回 binding
    const updatedBindings = bindings.map((b) =>
      b.featureKey === "personal_room" ? { ...b, panelMessageId: message.id } : b
    );
    // 若 personal_room binding 不存在則新增
    if (!updatedBindings.some((b) => b.featureKey === "personal_room")) {
      updatedBindings.push(normalizeBinding({ featureKey: "personal_room", channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return {
      channelId: targetChannelId,
      messageId: message.id
    };
  }

  async listAllPlayers(limit = 50) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 50));
    const players = await this.playerRepository.listAll();
    return players.slice(0, safeLimit);
  }

  async getPlayerQueryInfo(targetDiscordId) {
    if (!targetDiscordId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "targetDiscordId is required", 400);
    }

    return this.adminService.getPlayerSnapshot(targetDiscordId);
  }

  async syncChannelPermissions(accessControl) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { PermissionsBitField } = require("discord.js");
    const client = getBotClient();
    if (!client?.isReady()) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Discord bot is not ready", 503);
    }

    const layout = await this.getChannelLayout();
    const enabledBindings = layout.discord.bindings.filter((b) => b.enabled && b.channelId);
    const discord = accessControl?.discord || {};
    const adminRoleIds = discord.adminRoleIds || [];
    const playerRoleIds = discord.playerRoleIds || [];
    const allManagedRoles = [...new Set([...adminRoleIds, ...playerRoleIds])];

    const results = [];

    for (const binding of enabledBindings) {
      const channel = await client.channels.fetch(binding.channelId).catch(() => null);
      if (!channel || typeof channel.permissionOverwrites === "undefined") continue;

      const grantRoles = new Set([
        ...(binding.visibleTo?.player ? playerRoleIds : []),
        ...(binding.visibleTo?.admin ? adminRoleIds : [])
      ]);

      let granted = 0;
      let revoked = 0;

      for (const roleId of allManagedRoles) {
        try {
          if (grantRoles.has(roleId)) {
            await channel.permissionOverwrites.edit(roleId, { ViewChannel: true });
            granted++;
          } else {
            const existing = channel.permissionOverwrites.cache.get(roleId);
            if (existing) {
              await channel.permissionOverwrites.delete(roleId);
              revoked++;
            }
          }
        } catch (_err) {
          // skip roles that can't be modified
        }
      }

      results.push({ featureKey: binding.featureKey, channelId: binding.channelId, granted, revoked });
    }

    return results;
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

  async publishCoinShopPanel(channelId) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { createCoinShopPanelMessage } = require("../../bot/coinShopView");

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

    // 刪除舊面板（如果記錄了 panelMessageId）
    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const existingBinding = bindings.find((b) => b.featureKey === "coin_shop");
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {});
    }

    const message = await channel.send(createCoinShopPanelMessage());

    const updatedBindings = bindings.map((b) =>
      b.featureKey === "coin_shop" ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.featureKey === "coin_shop")) {
      updatedBindings.push(normalizeBinding({ featureKey: "coin_shop", channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }

  async publishMonsterZonePanel(channelId, monster, currentHp, options = {}) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { createMonsterZonePanelMessage } = require("../../bot/monsterZoneView");

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

    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const existingBinding = bindings.find((b) => b.featureKey === "monster_zone");
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {});
    }

    const panelMsg = createMonsterZonePanelMessage(monster || null, currentHp ?? null, options?.participantCount ?? 0);
    const message = await channel.send(panelMsg);

    const updatedBindings = bindings.map((b) =>
      b.featureKey === "monster_zone" ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.featureKey === "monster_zone")) {
      updatedBindings.push(normalizeBinding({ featureKey: "monster_zone", channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }
}

module.exports = {
  AdminConsoleService,
  AVAILABLE_FEATURES
};