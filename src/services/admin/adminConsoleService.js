const { AppError, ERROR_CODES } = require("../../shared/errors");
const { createPlayerPanelMessage } = require("../../bot/playerPanelView");
const config = require("../../config");
const { featureKeyToZone, zoneToFeatureKey } = require("../../shared/zones");

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
    key: "auction_house",
    label: "交易所面板",
    description: "拍賣場與玩家交易入口"
  },
  {
    key: "personal_room",
    label: "個人房間面板",
    description: "玩家個人化功能與私人操作"
  },
  {
    key: "monster_zone_beginner",
    label: "放怪區面板（新手）",
    description: "Lv.1～3 新手專屬戰鬥區"
  },
  {
    key: "monster_zone",
    label: "放怪區面板（一般）",
    description: "Lv.1 以上玩家可進入的一般戰鬥區"
  },
  {
    key: "monster_zone_mid",
    label: "放怪區面板（中級）",
    description: "Lv.10 以上玩家可進入的中級戰鬥區"
  },
  {
    key: "monster_zone_hard",
    label: "放怪區面板（高級）",
    description: "Lv.20 以上玩家可進入的高級戰鬥區"
  },
  {
    key: "monster_zone_elite",
    label: "放怪區面板（精英）",
    description: "Lv.20 以上玩家可進入的精英戰鬥區"
  },
  {
    key: "weekly_quest",
    label: "每週任務面板",
    description: "每週任務查看與獎勵領取入口"
  },
  {
    key: "idle_zone",
    label: "掛機區面板",
    description: "放置掛機入口與獎勵查看面板"
  }
];

function normalizeLevelBound(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(999, parsed));
}

function normalizeBinding(binding) {
  const visibleTo = binding?.visibleTo && typeof binding.visibleTo === "object" ? binding.visibleTo : {};
  const featureKey = String(binding.featureKey || "").trim();

  const normalized = {
    featureKey,
    channelId: String(binding.channelId || "").trim(),
    enabled: Boolean(binding.enabled),
    note: String(binding.note || "").trim(),
    panelMessageId: String(binding.panelMessageId || "").trim(),
    visibleTo: {
      player: visibleTo.player !== false,
      admin: visibleTo.admin !== false
    }
  };

  // monster zone 自訂等級上下限需被保留，否則會在儲存時遺失
  if (featureKey.startsWith("monster_zone")) {
    normalized.minLevel = normalizeLevelBound(binding?.minLevel);
    normalized.maxLevel = normalizeLevelBound(binding?.maxLevel);
  }

  return normalized;
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

    if (
      binding.featureKey.startsWith("monster_zone") &&
      binding.minLevel != null &&
      binding.maxLevel != null &&
      binding.maxLevel < binding.minLevel
    ) {
      throw new AppError(
        ERROR_CODES.INVALID_ARGUMENT,
        `monster zone level range invalid: ${binding.featureKey} maxLevel(${binding.maxLevel}) < minLevel(${binding.minLevel})`,
        400
      );
    }

    seen.add(binding.featureKey);
  }

  return normalized;
}

// 序列化 monster_zone 面板發布，防止並發競爭
let _panelPublishMutex = null;

class AdminConsoleService {
  constructor(channelLayoutRepository, playerRepository, adminService, walletRepository, progressRepository, checkinRepository, worldBossService = null) {
    this.channelLayoutRepository = channelLayoutRepository;
    this.playerRepository = playerRepository;
    this.adminService = adminService;
    this.walletRepository = walletRepository;
    this.progressRepository = progressRepository;
    this.checkinRepository = checkinRepository;
    this.worldBossService = worldBossService;
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

  async _clearChannelMessages(channel, { includePinned = false } = {}) {
    try {
      const fetched = await channel.messages.fetch({ limit: 100 });
      const toDelete = fetched.filter((msg) => includePinned || !msg.pinned);
      if (toDelete.size === 0) return;

      await channel.bulkDelete(toDelete, true).catch(() => {});
      for (const [, msg] of toDelete) {
        if (!msg.bulkDeletable) {
          await msg.delete().catch(() => {});
        }
      }
    } catch (_) {
      // suppressed
    }
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

  async publishPlayerPanel(channelId, options = {}) {
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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned !== false });
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

  async getLeaderboard(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const [players, wallets, progresses, checkinCounts] = await Promise.all([
      this.playerRepository.listAll(),
      this.walletRepository.listAll(),
      this.progressRepository.listAll(),
      this.checkinRepository.countAllByPlayer()
    ]);

    const walletMap = Object.fromEntries(wallets.map((w) => [w.playerId, w]));
    const progressMap = Object.fromEntries(progresses.map((p) => [p.playerId, p]));

    const rows = players
      .filter((p) => p.status !== "disabled")
      .map((p) => ({
        discordId: p.discordId,
        displayName: p.displayName,
        gold: walletMap[p.discordId]?.gold ?? 0,
        diamond: walletMap[p.discordId]?.diamond ?? 0,
        level: progressMap[p.discordId]?.level ?? 1,
        exp: progressMap[p.discordId]?.exp ?? 0,
        checkinCount: checkinCounts[p.discordId] ?? 0
      }));

    return {
      gold: [...rows].sort((a, b) => b.gold - a.gold).slice(0, safeLimit),
      level: [...rows].sort((a, b) => b.level - a.level || b.exp - a.exp).slice(0, safeLimit),
      checkin: [...rows].sort((a, b) => b.checkinCount - a.checkinCount).slice(0, safeLimit)
    };
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
    const adminUserIds = discord.adminUserIds || [];
    const playerUserIds = discord.playerUserIds || [];
    const allManagedRoles = [...new Set([...adminRoleIds, ...playerRoleIds])];
    const allManagedUsers = [...new Set([...adminUserIds, ...playerUserIds])];

    const results = [];

    for (const binding of enabledBindings) {
      const channel = await client.channels.fetch(binding.channelId).catch(() => null);
      if (!channel || typeof channel.permissionOverwrites === "undefined") continue;

      const grantRoles = new Set([
        ...(binding.visibleTo?.player ? playerRoleIds : []),
        ...(binding.visibleTo?.admin ? adminRoleIds : [])
      ]);
      const grantUsers = new Set([
        ...(binding.visibleTo?.player ? playerUserIds : []),
        ...(binding.visibleTo?.admin ? adminUserIds : [])
      ]);

      let granted = 0;
      let revoked = 0;

      // 受眾面板要採「先鎖全部，再放行白名單」：
      // - 只要可見對象不是「玩家+管理員都開」，就強制鎖 @everyone
      // - 或者雖然都開，但有任一白名單設定時也鎖 @everyone 再放行
      const hasAudienceToggle =
        binding.visibleTo?.player !== true || binding.visibleTo?.admin !== true;
      const hasAnyRestrictionConfig =
        allManagedRoles.length > 0 || allManagedUsers.length > 0;
      const shouldDenyEveryone = hasAudienceToggle || hasAnyRestrictionConfig;

      if (shouldDenyEveryone) {
        try {
          await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false });
        } catch (_err) {
          // ignore
        }
      } else {
        // 無白名單配置時，回復 @everyone 預設（刪除覆寫）
        try {
          const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
          if (everyoneOverwrite) {
            await channel.permissionOverwrites.delete(channel.guild.roles.everyone.id);
          }
        } catch (_err) {
          // ignore
        }
      }

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

      for (const userId of allManagedUsers) {
        try {
          if (grantUsers.has(userId)) {
            await channel.permissionOverwrites.edit(userId, { ViewChannel: true });
            granted++;
          } else {
            const existing = channel.permissionOverwrites.cache.get(userId);
            if (existing) {
              await channel.permissionOverwrites.delete(userId);
              revoked++;
            }
          }
        } catch (_err) {
          // skip users that can't be modified
        }
      }

      results.push({
        featureKey: binding.featureKey,
        channelId: binding.channelId,
        granted,
        revoked,
        everyoneDenied: shouldDenyEveryone
      });
    }

    return results;
  }

  async publishPlayerQueryPanel(channelId, options = {}) {
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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned !== false });
    }

    const message = await channel.send(createPlayerQueryPanelMessage());
    return {
      channelId: targetChannelId,
      messageId: message.id
    };
  }

  async publishCoinShopPanel(channelId, options = {}) {
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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned !== false });
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
    // ── 並發保護：admin 強制發布等待中的操作完成；自動更新若正在發布則跳過 ──
    if (_panelPublishMutex) {
      if (!options.cleanChannel) return; // 自動更新：跳過，避免堆積
      await _panelPublishMutex;          // 管理員手動：等待上一次完成後再執行
    }
    let _resolve;
    _panelPublishMutex = new Promise((r) => { _resolve = r; });
    try {
      return await this._doPublishMonsterZonePanel(channelId, monster, currentHp, options);
    } finally {
      _panelPublishMutex = null;
      _resolve();
    }
  }

  async _doPublishMonsterZonePanel(channelId, monster, currentHp, options = {}) {
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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned === true });
    }

    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const resolvedZoneKey = options?.zoneKey || monster?.zone || null;
    const preferredFeatureKey =
      options?.featureKey ||
      (resolvedZoneKey ? zoneToFeatureKey(resolvedZoneKey) : null) ||
      "monster_zone";

    const existingBinding = bindings.find(
      (b) => b.channelId === targetChannelId && b.featureKey === preferredFeatureKey
    ) || bindings.find(
      (b) => b.channelId === targetChannelId && b.featureKey?.startsWith("monster_zone")
    );
    const boundFeatureKey = existingBinding?.featureKey || preferredFeatureKey;

    const finalZoneKey = resolvedZoneKey || featureKeyToZone(boundFeatureKey);
    let worldBossStatus = null;
    if (finalZoneKey === "elite" && this.worldBossService) {
      const wb = await this.worldBossService.getConfigWithStatus().catch(() => null);
      worldBossStatus = wb?.status || null;
    }

    const panelMsg = await createMonsterZonePanelMessage(
      monster || null,
      currentHp ?? null,
      options?.participantCount ?? 0,
      options?.damageMap ?? {},
      {
        activeEvent: options?.activeEvent || null,
        zoneKey: finalZoneKey,
        zoneBinding: existingBinding || null,
        worldBossStatus,
        worldBossPartsHp: options?.worldBossPartsHp || null,
        fastUpdate: options?.fastUpdate === true
      }
    );

    let message = null;

    if (options.cleanChannel) {
      // 管理員重新發布：先清空頻道訊息再發新的
      message = await channel.send(panelMsg);
    } else {
      // 自動更新：優先 edit 現有訊息，避免多人同時觸發時產生多個面板
      if (existingBinding?.panelMessageId) {
        message = await channel.messages.fetch(existingBinding.panelMessageId)
          .then((msg) => msg.edit(panelMsg))
          .catch(() => null);
      }
      if (!message) {
        message = await channel.send(panelMsg);
      }
    }

    const updatedBindings = bindings.map((b) =>
      b.channelId === targetChannelId && b.featureKey === boundFeatureKey ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.channelId === targetChannelId && b.featureKey === boundFeatureKey)) {
      updatedBindings.push(normalizeBinding({ featureKey: boundFeatureKey, channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }

  async publishWeeklyQuestPanel(channelId, options = {}) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { createWeeklyQuestPanelMessage } = require("../../bot/weeklyQuestView");

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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned !== false });
    }

    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const existingBinding = bindings.find((b) => b.featureKey === "weekly_quest");
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {});
    }

    const message = await channel.send(createWeeklyQuestPanelMessage());

    const updatedBindings = bindings.map((b) =>
      b.featureKey === "weekly_quest" ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.featureKey === "weekly_quest")) {
      updatedBindings.push(normalizeBinding({ featureKey: "weekly_quest", channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }

  async publishDailyQuestPanel(channelId, options = {}) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { createDailyQuestPanelMessage } = require("../../bot/weeklyQuestView");

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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned !== false });
    }

    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const existingBinding = bindings.find((b) => b.featureKey === "daily_quest");
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {});
    }

    const message = await channel.send(createDailyQuestPanelMessage());

    const updatedBindings = bindings.map((b) =>
      b.featureKey === "daily_quest" ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.featureKey === "daily_quest")) {
      updatedBindings.push(normalizeBinding({ featureKey: "daily_quest", channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }

  async publishIdleZonePanel(channelId, options = {}) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const { createIdleZonePanelMessage } = require("../../bot/idleZoneView");

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

    if (options.cleanChannel) {
      await this._clearChannelMessages(channel, { includePinned: options.includePinned !== false });
    }

    const stored = await this.channelLayoutRepository.get();
    const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const existingBinding = bindings.find((b) => b.featureKey === "idle_zone");
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {});
    }

    const message = await channel.send(createIdleZonePanelMessage());

    const updatedBindings = bindings.map((b) =>
      b.featureKey === "idle_zone" ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.featureKey === "idle_zone")) {
      updatedBindings.push(normalizeBinding({ featureKey: "idle_zone", channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }
}

module.exports = {
  AdminConsoleService,
  AVAILABLE_FEATURES
};
