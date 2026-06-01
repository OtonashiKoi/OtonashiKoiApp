const { AppError, ERROR_CODES } = require("../../shared/errors");
const { createPlayerPanelMessage } = require("../../bot/playerPanelView");
const config = require("../../config");
const { featureKeyToZone, zoneToFeatureKey } = require("../../shared/zones");
const { isWorldBossZone } = require("../worldBoss/worldBossService");

const AVAILABLE_FEATURES = [
  // ─── 系統面板 ────────────────────────────────
  { key: "park_announcement", label: "樂園公告面板", description: "遊戲公告與活動資訊", category: "system" },
  { key: "town_chat", label: "聊天大街面板", description: "玩家聊天室與社群互動", category: "system" },
  { key: "coin_shop", label: "金幣商店面板", description: "商店與資源兌換功能", category: "system" },
  { key: "auction_house", label: "交易所面板", description: "拍賣場與玩家交易入口", category: "system" },
  { key: "personal_room", label: "個人房間面板", description: "玩家個人化功能與私人操作", category: "system" },
  { key: "idle_zone", label: "掛機區面板", description: "放置掛機入口與獎勵查看面板", category: "system" },
  { key: "casino_wheel", label: "命運轉盤面板", description: "賭場轉盤每 60 秒開獎，押注金幣與裝備抽獎入口", category: "system" },

  // ─── 社群頻道 ────────────────────────────────
  { key: "broadcast", label: "系統廣播頻道", description: "強化/PK 排行/掉落公告等系統廣播", category: "social" },
  { key: "general_chat", label: "一般聊天頻道", description: "樂園日常聊天", category: "social" },
  { key: "beginner_tutorial", label: "新手教學頻道", description: "新手教學引導", category: "social" },
  { key: "trade_discussion", label: "玩家收購討論版", description: "玩家收購／求購討論", category: "social" },
  { key: "feedback", label: "樂園建議回報", description: "玩家建議與回報專區", category: "social" },

  // ─── PK / 組隊 ───────────────────────────────
  { key: "pk_arena", label: "PK 大亂鬥頻道", description: "PK 對戰入口", category: "pk_party" },
  { key: "pk_report", label: "PK 戰報頻道", description: "PK 對戰結果公告", category: "pk_party" },
  { key: "party_lobby", label: "組隊大廳", description: "組隊大廳入口", category: "pk_party" },
  { key: "party_guide", label: "組隊攻略區", description: "組隊攻略與討論", category: "pk_party" },

  // ─── 怪物地圖 ────────────────────────────────
  { key: "monster_zone_beginner", label: "放怪區面板（新手）", description: "Lv.1～3 新手專屬戰鬥區", category: "monster" },
  { key: "monster_zone", label: "放怪區面板（一般）", description: "Lv.1 以上玩家可進入的一般戰鬥區", category: "monster" },
  { key: "monster_zone_mid", label: "放怪區面板（中級）", description: "Lv.10 以上玩家可進入的中級戰鬥區", category: "monster" },
  { key: "monster_zone_hard", label: "放怪區面板（高級）", description: "Lv.20 以上玩家可進入的高級戰鬥區", category: "monster" },
  { key: "monster_zone_ancient_city", label: "放怪區面板（古城）", description: "Lv.20 以上 — 古城地圖", category: "monster" },
  { key: "monster_zone_ancient_city_deep", label: "放怪區面板（古城深處）", description: "Lv.30-40 — 古城深處地圖", category: "monster" },
  { key: "monster_zone_dragon_realm", label: "放怪區面板（龍族之領）", description: "Lv.40-50 — 龍族之領，A 階秘銀裝備產地", category: "monster" },
  { key: "monster_zone_dragon_king_lair", label: "世界王面板（龍王巢穴）", description: "Lv.40+ — 古龍王(B)，需先擊敗本週大史王才解鎖", category: "monster" },
  { key: "pet_panel", label: "寵物面板", description: "寵物孵化 / 餵食 / 採集站", category: "system" },
  { key: "monster_zone_wasteland_throne", label: "放怪區面板（廢都王座）", description: "Lv.30 以上 — 廢都王座地圖", category: "monster" },
  { key: "monster_zone_elite", label: "放怪區面板（精英）", description: "Lv.20 以上玩家可進入的精英戰鬥區", category: "monster" },
  { key: "monster_zone_nightmare", label: "放怪區面板（噩夢）", description: "Lv.30 以上玩家可進入的噩夢戰鬥區", category: "monster" },
  { key: "monster_zone_abyss", label: "放怪區面板（深淵）", description: "Lv.45 以上玩家可進入的深淵戰鬥區", category: "monster" },
  { key: "monster_zone_mythic", label: "放怪區面板（神話）", description: "Lv.60 以上玩家可進入的神話戰鬥區", category: "monster" }
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

// 序列化所有 channelLayout 寫入：避免不同 publish 函式 read-modify-write 互相覆蓋
let _panelPublishMutex = null;

// 通用佇列 helper：把所有 channelLayout 修改串成一條 promise chain
function _runOnLayoutMutex(fn, { skipIfBusy = false } = {}) {
  if (_panelPublishMutex && skipIfBusy) return Promise.resolve(undefined);
  const prev = _panelPublishMutex || Promise.resolve();
  const jobPromise = prev.then(fn, fn);
  _panelPublishMutex = jobPromise;
  const cleanup = () => {
    if (_panelPublishMutex === jobPromise) _panelPublishMutex = null;
  };
  jobPromise.then(cleanup, cleanup);
  return jobPromise;
}

class AdminConsoleService {
  constructor(channelLayoutRepository, playerRepository, adminService, walletRepository, progressRepository, checkinRepository, worldBossService = null, worldBossServiceFor = null) {
    this.channelLayoutRepository = channelLayoutRepository;
    this.playerRepository = playerRepository;
    this.adminService = adminService;
    this.walletRepository = walletRepository;
    this.progressRepository = progressRepository;
    this.checkinRepository = checkinRepository;
    this.worldBossService = worldBossService;
    // 依 zone 取對應世界王 service（多隻世界王用；無則退回 default）
    this.worldBossServiceFor = worldBossServiceFor || (() => this.worldBossService);
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

    // 保留既有 panelMessageId — 前端表單沒送這個欄位，若不保留會被覆蓋成空字串，
    // 導致後續自動更新找不到面板。
    const stored = await this.channelLayoutRepository.get().catch(() => ({ discord: { bindings: [] } }));
    const existingBindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
    const merged = normalized.map((b) => {
      if (b.panelMessageId) return b; // 前端有送就用前端的（極少數情況）
      const prior = existingBindings.find(
        (x) => x.featureKey === b.featureKey && x.channelId === b.channelId
      );
      return prior?.panelMessageId ? { ...b, panelMessageId: prior.panelMessageId } : b;
    });

    const next = {
      ...stored,
      discord: {
        ...(stored?.discord || {}),
        bindings: merged
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

      // 先嘗試 bulk delete（最多 14 天內），記錄成敗
      let bulkOk = false;
      await channel.bulkDelete(toDelete, true)
        .then(() => { bulkOk = true; })
        .catch((err) => {
          console.warn(`[ClearChannel] bulkDelete failed in ${channel.id}: ${err?.message || err}`);
        });

      // 重新抓一次確認目前狀態，個別刪除剩下的（包括 bulk 失敗或 >14 天的）
      const remaining = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (remaining) {
        const stillThere = remaining.filter((msg) => (includePinned || !msg.pinned) && toDelete.has(msg.id));
        if (stillThere.size > 0) {
          console.warn(`[ClearChannel] ${stillThere.size} message(s) survived bulkDelete in ${channel.id}, deleting individually`);
          for (const [, msg] of stillThere) {
            await msg.delete().catch((err) => {
              console.warn(`[ClearChannel] individual delete failed for ${msg.id}: ${err?.message || err}`);
            });
          }
        }
      } else if (!bulkOk) {
        // 連 re-fetch 都失敗，至少嘗試對 cached 訊息個別刪除
        for (const [, msg] of toDelete) {
          await msg.delete().catch(() => {});
        }
      }
    } catch (err) {
      console.warn(`[ClearChannel] failed in ${channel.id}: ${err?.message || err}`);
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

    const { ChannelType } = require("discord.js");
    // 可發布面板/可同步權限的頻道類型：文字、公告、論壇、媒體
    const ALLOWED_TYPES = new Set([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildForum,
      ChannelType.GuildMedia
    ]);

    return channels
      .filter((channel) => channel && ALLOWED_TYPES.has(channel.type))
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
    return _runOnLayoutMutex(async () => {
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

      const stored = await this.channelLayoutRepository.get();
      const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
      const existingBinding = bindings.find((b) => b.featureKey === "personal_room");
      if (existingBinding?.panelMessageId) {
        await channel.messages.fetch(existingBinding.panelMessageId)
          .then((msg) => msg.delete())
          .catch(() => {});
      }

      const message = await channel.send(createPlayerPanelMessage());

      const updatedBindings = bindings.map((b) =>
        b.featureKey === "personal_room" ? { ...b, panelMessageId: message.id } : b
      );
      if (!updatedBindings.some((b) => b.featureKey === "personal_room")) {
        updatedBindings.push(normalizeBinding({ featureKey: "personal_room", channelId: targetChannelId, panelMessageId: message.id }));
      }
      await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

      return {
        channelId: targetChannelId,
        messageId: message.id
      };
    });
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

    // 平行處理所有頻道 — Discord rate limit 是 per-channel/per-route，
    // 不同頻道之間互不影響；同一頻道內的 role/user edit 也可以併發
    const results = await Promise.all(enabledBindings.map(async (binding) => {
      const channel = await client.channels.fetch(binding.channelId).catch(() => null);
      if (!channel || typeof channel.permissionOverwrites === "undefined") {
        return null;
      }

      const grantRoles = new Set([
        ...(binding.visibleTo?.player ? playerRoleIds : []),
        ...(binding.visibleTo?.admin ? adminRoleIds : [])
      ]);
      const grantUsers = new Set([
        ...(binding.visibleTo?.player ? playerUserIds : []),
        ...(binding.visibleTo?.admin ? adminUserIds : [])
      ]);

      const hasAudienceToggle =
        binding.visibleTo?.player !== true || binding.visibleTo?.admin !== true;
      const hasAnyRestrictionConfig =
        allManagedRoles.length > 0 || allManagedUsers.length > 0;
      const shouldDenyEveryone = hasAudienceToggle || hasAnyRestrictionConfig;

      let granted = 0;
      let revoked = 0;

      const tasks = [];

      // @everyone
      if (shouldDenyEveryone) {
        tasks.push(
          channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false }).catch(() => {})
        );
      } else {
        const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
        if (everyoneOverwrite) {
          tasks.push(channel.permissionOverwrites.delete(channel.guild.roles.everyone.id).catch(() => {}));
        }
      }

      // 管理身分組
      for (const roleId of allManagedRoles) {
        if (grantRoles.has(roleId)) {
          tasks.push(
            channel.permissionOverwrites.edit(roleId, { ViewChannel: true })
              .then(() => { granted++; })
              .catch(() => {})
          );
        } else if (channel.permissionOverwrites.cache.get(roleId)) {
          tasks.push(
            channel.permissionOverwrites.delete(roleId)
              .then(() => { revoked++; })
              .catch(() => {})
          );
        }
      }

      // 管理用戶
      for (const userId of allManagedUsers) {
        if (grantUsers.has(userId)) {
          tasks.push(
            channel.permissionOverwrites.edit(userId, { ViewChannel: true })
              .then(() => { granted++; })
              .catch(() => {})
          );
        } else if (channel.permissionOverwrites.cache.get(userId)) {
          tasks.push(
            channel.permissionOverwrites.delete(userId)
              .then(() => { revoked++; })
              .catch(() => {})
          );
        }
      }

      await Promise.all(tasks);

      return {
        featureKey: binding.featureKey,
        channelId: binding.channelId,
        granted,
        revoked,
        everyoneDenied: shouldDenyEveryone,
        skippedRoles: allManagedRoles.length === 0 && allManagedUsers.length === 0
      };
    }));

    return results.filter(Boolean);
  }

  async publishPlayerQueryPanel(channelId, options = {}) {
    return _runOnLayoutMutex(async () => {
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

      const stored = await this.channelLayoutRepository.get();
      const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
      const existingBinding = bindings.find((b) => b.featureKey === "player_query");
      if (existingBinding?.panelMessageId) {
        await channel.messages.fetch(existingBinding.panelMessageId)
          .then((msg) => msg.delete())
          .catch(() => {});
      }

      const message = await channel.send(createPlayerQueryPanelMessage());

      const updatedBindings = bindings.map((b) =>
        b.featureKey === "player_query" ? { ...b, panelMessageId: message.id } : b
      );
      if (!updatedBindings.some((b) => b.featureKey === "player_query")) {
        updatedBindings.push(normalizeBinding({ featureKey: "player_query", channelId: targetChannelId, panelMessageId: message.id }));
      }
      await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

      return { channelId: targetChannelId, messageId: message.id };
    });
  }

  async publishCoinShopPanel(channelId, options = {}) {
    return _runOnLayoutMutex(async () => {
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
    });
  }

  async publishMonsterZonePanel(channelId, monster, currentHp, options = {}) {
    // 自動更新 (no cleanChannel) 遇到忙碌時跳過；手動發布排隊執行
    return _runOnLayoutMutex(
      () => this._doPublishMonsterZonePanel(channelId, monster, currentHp, options),
      { skipIfBusy: !options.cleanChannel }
    );
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
    if (isWorldBossZone(finalZoneKey)) {
      const wbService = this.worldBossServiceFor(finalZoneKey) || this.worldBossService;
      if (wbService) {
        const wb = await wbService.getConfigWithStatus().catch(() => null);
        worldBossStatus = wb?.status || null;
      }
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
      // 管理員手動重新發布：才允許清空頻道並發新訊息
      message = await channel.send(panelMsg);
    } else {
      // 自動更新（怪物切換/刷新）：永遠只 edit，不發新訊息
      let existingMsg = null;
      if (existingBinding?.panelMessageId) {
        existingMsg = await channel.messages.fetch(existingBinding.panelMessageId).catch(() => null);
      }
      // 找不到 → 不要送新的，直接放棄這次更新（等下次 refresh 再說）
      if (!existingMsg) {
        console.warn(`[MonsterPanel] auto-update skipped: panel message ${existingBinding?.panelMessageId || "(none)"} not found in channel ${targetChannelId}`);
        return { channelId: targetChannelId, messageId: existingBinding?.panelMessageId || null };
      }
      message = await existingMsg.edit(panelMsg).catch((err) => {
        console.warn(`[MonsterPanel] edit failed channel=${targetChannelId} msg=${existingMsg.id}: ${err?.message || err}`);
        return null;
      });
      // edit 失敗也不送新，避免疊出新面板
      if (!message) {
        return { channelId: targetChannelId, messageId: existingMsg.id };
      }
    }

    if (!message) return { channelId: targetChannelId, messageId: null };

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
    return _runOnLayoutMutex(() => this._doPublishSimplePanel("weekly_quest", channelId, options));
  }

  async publishDailyQuestPanel(channelId, options = {}) {
    return _runOnLayoutMutex(() => this._doPublishSimplePanel("daily_quest", channelId, options));
  }

  async publishIdleZonePanel(channelId, options = {}) {
    return _runOnLayoutMutex(() => this._doPublishSimplePanel("idle_zone", channelId, options));
  }

  async publishPetPanel(channelId, options = {}) {
    return _runOnLayoutMutex(() => this._doPublishSimplePanel("pet_panel", channelId, options));
  }

  async publishCasinoPanel(channelId, options = {}) {
    return _runOnLayoutMutex(() => {
      const { publishCasinoPanel } = require("../../bot/handlers/casinoHandlers");
      return publishCasinoPanel(channelId, options);
    });
  }

  async setCasinoEnabled(enabled) {
    return _runOnLayoutMutex(async () => {
      const stored = await this.channelLayoutRepository.get();
      const bindings = Array.isArray(stored?.discord?.bindings) ? stored.discord.bindings : [];
      const updated = bindings.map((b) => b.featureKey === "casino_wheel" ? { ...b, enabled: Boolean(enabled) } : b);
      if (!updated.some((b) => b.featureKey === "casino_wheel")) {
        updated.push(normalizeBinding({ featureKey: "casino_wheel", enabled: Boolean(enabled) }));
      }
      await this.channelLayoutRepository.save({ discord: { ...(stored?.discord || {}), bindings: updated } });
      try {
        const { setPanelEnabled } = require("../../bot/handlers/casinoHandlers");
        setPanelEnabled(Boolean(enabled));
      } catch (_) {}
      return { enabled: Boolean(enabled) };
    });
  }

  // 共用「簡單」面板發布邏輯（weekly_quest / daily_quest / idle_zone）
  async _doPublishSimplePanel(featureKey, channelId, options = {}) {
    const { getBotClient } = require("../../bot/runtimeContext");
    const VIEW_FACTORIES = {
      weekly_quest: () => require("../../bot/weeklyQuestView").createWeeklyQuestPanelMessage(),
      daily_quest:  () => require("../../bot/weeklyQuestView").createDailyQuestPanelMessage(),
      idle_zone:    () => require("../../bot/idleZoneView").createIdleZonePanelMessage(),
      pet_panel:    () => require("../../bot/petPanelView").createPetPanelMessage(),
    };
    const createMessage = VIEW_FACTORIES[featureKey];
    if (!createMessage) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unknown feature: ${featureKey}`, 400);

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
    const existingBinding = bindings.find((b) => b.featureKey === featureKey);
    if (existingBinding?.panelMessageId) {
      await channel.messages.fetch(existingBinding.panelMessageId)
        .then((msg) => msg.delete())
        .catch(() => {});
    }

    const message = await channel.send(await createMessage());

    const updatedBindings = bindings.map((b) =>
      b.featureKey === featureKey ? { ...b, panelMessageId: message.id } : b
    );
    if (!updatedBindings.some((b) => b.featureKey === featureKey)) {
      updatedBindings.push(normalizeBinding({ featureKey, channelId: targetChannelId, panelMessageId: message.id }));
    }
    await this.channelLayoutRepository.save({ discord: { ...(stored.discord || {}), bindings: updatedBindings } });

    return { channelId: targetChannelId, messageId: message.id };
  }
}

module.exports = {
  AdminConsoleService,
  AVAILABLE_FEATURES
};
