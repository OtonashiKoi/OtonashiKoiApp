const { Router } = require("express");
const jwt = require("jsonwebtoken");
const { ok } = require("../../shared/response");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { getSnapshot: getStreamPresenceSnapshot } = require("../../services/stream/streamPresence");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
const { isEffectConditionMet, decrementActiveEffects, collectEquipmentEffects, mergeEquippedFromLibrary } = require("../../shared/effectEngine");

// Track per-player battle cooldowns.
// Cooldown duration matches battle animation time: round logs * 700ms + 2s buffer.
const playerBattleCooldowns = new Map();

// 每回合動畫長度（ms）。可用 env `ROUND_MS` 覆寫。預設為 700 * 0.8
const ROUND_MS = Number(process.env.ROUND_MS || Math.round(700 * 0.8));

function createPlayerAppRoutes(serviceContext, discordClient) {
  const router = Router();

  const buildJobSpecialDisplay = (progress) => {
    const equipped = progress?.equipment || {};
    const inventory = progress?.inventory || [];
    const jobEq = equipped.job_eq || null;
    if (!jobEq) {
      return { jobName: null, activeSpecials: [], summary: "無（未裝備職業裝）" };
    }
    const refs = [
      ...(Array.isArray(jobEq.passiveEffects) ? jobEq.passiveEffects : []),
      ...(Array.isArray(jobEq.procEffects) ? jobEq.procEffects : []),
      ...(Array.isArray(jobEq.combatEffects) ? jobEq.combatEffects : [])
    ];
    const context = { equipped, inventory };
    const activeSpecials = refs
      .filter((effect) => isEffectConditionMet(effect, context))
      .map((effect) => {
        const name = EFFECT_NAME_ZH[effect.key] || effect.definitionName || effect.key;
        const value = Number(effect?.params?.value);
        return Number.isFinite(value) ? `${name}(${value})` : name;
      });
    return {
      jobName: jobEq.itemName || null,
      activeSpecials,
      summary: activeSpecials.length > 0 ? activeSpecials.join("、") : "目前無符合條件的啟用效果"
    };
  };

  const buildCombatZonesSnapshot = async (discordId = null) => {
    const keys = ["normal", "mid"];
    return Promise.all(keys.map(async (key) => {
      const [state, monsters] = await Promise.all([
        serviceContext.monsterService.getState(key),
        serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: key })
      ]);
      let activeMonster = monsters.find((m) => m.seq === state.activeMonsterSeq);
      if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

      const dmgMap = state.damageMap || {};
      const damageLeaderboard = Object.values(dmgMap)
        .sort((a, b) => b.damage - a.damage)
        .slice(0, 10);

      const cooldown = discordId ? playerBattleCooldowns.get(discordId) : null;
      const nextBattleAt = (cooldown && cooldown.nextBattleAt > Date.now()) ? cooldown.nextBattleAt : null;

      return {
        zone: key,
        monsterId: activeMonster?.id || null,
        monsterName: activeMonster?.name || "未設定",
        monsterImageUrl: activeMonster?.imageUrl || null,
        monsterLevel: activeMonster?.level || 0,
        expReward: activeMonster?.expReward || 0,
        goldReward: activeMonster?.goldReward || 0,
        drops: (activeMonster?.drops || []).map((d) => d.itemName),
        currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
        maxHp: activeMonster?.calc?.maxHp || 0,
        participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
        activeMonsterSeq: state.activeMonsterSeq,
        damageLeaderboard,
        nextBattleAt,
      };
    }));
  };

  // Middleware for checking JWT
  const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ status: "error", message: "Missing token" });

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
      req.playerRecord = decoded; // { discordId, displayName }
      next();
    } catch (err) {
      return res.status(401).json({ status: "error", message: "Invalid or expired token" });
    }
  };

  // 1. OAuth2 Login
  router.post("/api/auth/discord", async (req, res, next) => {
    try {
      const { code } = req.body;
      let discordId;
      let displayName = "WebPlayer";

      // Development shortcut: treat codes prefixed with "mock:" as mock Discord logins.
      if (code.startsWith("mock:")) {
        console.log("[PlayerApp] Development mode mock login");
        discordId = code.replace("mock:", "");
        if (discordId.length < 5) discordId = "1450019975031951370"; // Fallback test account for local development.
      } else {
        // Exchange the authorization code with Discord OAuth2.
        if (!process.env.DISCORD_CLIENT_SECRET) {
          return res.status(500).json({ status: "error", message: "Server missing DISCORD_CLIENT_SECRET; Discord login is unavailable." });
        }
        // redirect_uri must match the value used to start the OAuth flow.
        const { redirect_uri } = req.body;
        if (!redirect_uri) {
          return res.status(400).json({ status: "error", message: "Missing redirect_uri" });
        }
        const params = new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri
        });

        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          body: params,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();
        
        // Debug
        console.log("[PlayerApp] Discord Auth Response:", tokenData);

        if (tokenData.error) {
           return res.status(400).json({ status: "error", message: `Discord auth failed: ${tokenData.error_description || tokenData.error}` });
        }

        const userRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        discordId = userData.id;
        displayName = userData.global_name || userData.username;
      }

      // Optional guild membership check before allowing web login.
      const guildId = require("../../config").discord.guildId;
      if (guildId && discordClient && !code.startsWith("mock:")) {
        try {
          const guild = discordClient.guilds.cache.get(guildId)
            || await discordClient.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
            if (!member) {
              return res.status(403).json({ status: "error", code: "NOT_GUILD_MEMBER", message: "You must join the Discord guild before using the web app." });
            }
            // Prefer guild nickname over OAuth profile name.
            displayName = member.displayName || displayName;
          }
        } catch (err) {
          console.warn("[PlayerApp] Guild membership check failed, skipping:", err.message);
        }
      }

      // Ensure player profile exists before returning a JWT.
      await serviceContext.playerService.ensurePlayer(discordId, displayName);

      // Issue JWT for the web app session.
      const token = jwt.sign({ discordId, displayName }, process.env.JWT_SECRET || "super-secret-jwt-key", { expiresIn: "7d" });
      res.json(ok({ token, discordId, displayName }));

    } catch (err) {
      next(err);
    }
  });

  // 2. Fetch Player Profile (Stats, Wallet, Progress)
  router.get("/api/me/profile", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      let avatarUrl = null;

      if (discordClient) {
        try {
          const discordUser = await discordClient.users.fetch(discordId, { force: false });
          avatarUrl = discordUser.displayAvatarURL({ size: 256, extension: 'png' });
        } catch (_) {}
      }
      
      const [profileResult, walletResult] = await Promise.all([
        serviceContext.playerService.getProfile(discordId, displayName),
        serviceContext.walletService.getWalletByDiscordId(discordId, displayName)
      ]);

      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      
      const { expToNextLevel, MAX_LEVEL } = require("../../shared/progression");
      const lv = progress?.level || 1;
      const isMaxLevel = lv >= MAX_LEVEL;
      const nextLevelExp = isMaxLevel ? null : expToNextLevel(lv);

      res.json(ok({
        player: {
          ...profileResult.player,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        wallet: walletResult.wallet,
        progress: {
          level: lv,
          maxLevel: MAX_LEVEL,
          jobLevel: progress?.jobLevel || 1,
          job: progress?.job || "Novice",
          exp: progress?.exp || 0,
          nextLevelExp,
          isMaxLevel,
          statusPoints: progress?.statusPoints || 0,
          playerTier: progress?.playerTier || "E",
          attributes: attrs,
          equipment: progress?.equipment || {},
          jobSpecialDisplay: buildJobSpecialDisplay(progress)
        }
      }));
    } catch (err) {
      next(err);
    }
  });

  // 3. Fetch Player Inventory
  router.get("/api/me/inventory", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const inventory = progress?.inventory || [];
      const equipped = progress?.equipment || {};
      res.json(ok({ inventory, equipped }));
    } catch (err) {
      next(err);
    }
  });

  // 3.1 Equip Item
  router.post("/api/me/inventory/equip/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { uuid } = req.params;
      const { targetSlot } = req.body || {};
      const result = await serviceContext.shopService.equipItem(discordId, uuid, targetSlot);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.2 Unequip Item
  router.post("/api/me/inventory/unequip/:slot", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { slot } = req.params;
      const result = await serviceContext.shopService.unequipItem(discordId, slot);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.3 Use Item (consumable effect)
  router.post("/api/me/inventory/use/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { uuid } = req.params;
      const result = await serviceContext.shopService.useItem(discordId, uuid, displayName);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.4 Discard Item
  router.post("/api/me/inventory/discard/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { uuid } = req.params;
      const result = await serviceContext.shopService.discardItem(discordId, uuid);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.5 Sell Item
  router.post("/api/me/inventory/sell/:uuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { uuid } = req.params;
      const result = await serviceContext.shopService.sellItem(discordId, uuid);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 3.6 Enhance Item
  router.post("/api/me/inventory/enhance", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { targetUuid, materialUuid } = req.body;
      if (!targetUuid || !materialUuid) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "targetUuid and materialUuid are required", 400);
      const result = await serviceContext.shopService.enhanceItem(discordId, targetUuid, materialUuid);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 4. Send Chat Lobby Message
  router.post("/api/chat/lobby", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { message } = req.body;
      
      if (!message || message.trim() === "") {
        throw new Error("Message cannot be empty");
      }

      // Resolve the bound Discord channel for town chat.
      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      
      if (townChatBinding && townChatBinding.channelId && discordClient) {
        const channel = discordClient.channels.cache.get(townChatBinding.channelId);
        if (channel) {
          // Try to mirror the player's Discord avatar in web chat.
          let avatarURL = null;
          try {
            const discordUser = await discordClient.users.fetch(discordId, { force: false });
            avatarURL = discordUser.displayAvatarURL({ size: 128, extension: 'png' });
          } catch (_) {}

          // Prefer webhook relay so the message appears under the player's display name.
          let webhook = null;
          try {
            const webhooks = await channel.fetchWebhooks();
            webhook = webhooks.find(w => w.name === 'PlayerWebChat' && w.owner?.id === discordClient.user.id);
            if (!webhook) {
              webhook = await channel.createWebhook({ name: 'PlayerWebChat', reason: 'Player web chat proxy' });
            }
          } catch (_) {}

          if (webhook) {
            await webhook.send({
              content: message,
              username: displayName,
              ...(avatarURL ? { avatarURL } : {}),
            });
          } else {
            // Fallback to a regular bot message if webhook creation fails.
            await channel.send(`**${displayName}**: ${message}`);
          }
        } else {
          console.warn(`[PlayerApp] ?曆???Town Chat ?駁? (ID: ${townChatBinding.channelId})`);
        }
      }

      res.json(ok({ status: "sent", message }));
    } catch (err) {
      next(err);
    }
  });

  // 5. SSE Client Management
  // SSE and notification helpers for relaying Discord chat into the web app.
  const resolveMentions = async (text, guild = null) => {
    if (!text || typeof text !== "string") return text;
    const mentionRegex = /<@!?(\d+)>/g;
    const matches = [...text.matchAll(mentionRegex)];
    let resolvedText = text;

    // Cache resolved mention names within a single pass to avoid duplicate fetches.
    const localCache = {};

    for (const match of matches) {
      const userId = match[1];
      if (localCache[userId]) {
        resolvedText = resolvedText.replace(match[0], `[@${localCache[userId]}]`);
        continue;
      }

      try {
        let playerName = null;
        
        // 1. Prefer the guild member display name when available.
        if (guild) {
          try {
            const member = await guild.members.fetch(userId);
            if (member) playerName = member.displayName;
          } catch (e) { /* ignore guild member lookup errors */ }
        }

        // 2. Fall back to stored player/profile records.
        if (!playerName) {
          const player = await serviceContext.playerRepository.findByDiscordId(userId);
          if (player) {
            playerName = player.displayName;
          } else if (serviceContext.progressRepository) {
            const progress = await serviceContext.progressRepository.findByPlayerId(userId);
            if (progress) playerName = progress.displayName;
          }
        }

        // 3. Final fallback: fetch directly from Discord API.
        if (!playerName && discordClient) {
          try {
            const user = await discordClient.users.fetch(userId);
            if (user) {
              playerName = user.globalName || user.username;
            }
          } catch (discordErr) { /* ignore */ }
        }

        if (playerName) {
          localCache[userId] = playerName;
          resolvedText = resolvedText.replace(match[0], `[@${playerName}]`);
        } else {
          console.warn(`[Chat] failed to resolve mention id: ${userId}`);
        }
      } catch (err) {
        console.error(`[Chat] mention resolve error: ${userId}`, err);
      }
    }
    return resolvedText;
  };

  // sseClients: Map<discordId, Set<{ res }>> for per-player browser tabs.
  const sseClients = new Map();
  const streamPresenceClients = new Set();
  // notifQueue: polling fallback for environments where SSE is buffered or blocked.
  const notifQueue = new Map();

  function enqueueNotif(discordId, summary) {
    if (!notifQueue.has(discordId)) notifQueue.set(discordId, []);
    const q = notifQueue.get(discordId);
    q.push({ ...summary, id: Date.now(), time: new Date().toLocaleTimeString("zh-TW") });
    if (q.length > 50) q.splice(0, q.length - 50); // Keep only the latest 50 notifications.
  }

  // Exposed to monster zone handlers so battle rewards can reach the web app.
  function pushRewardToPlayer(discordId, summary) {
    // 1. Always queue the notification for polling fallback.
    enqueueNotif(discordId, summary);
    // 2. Push instantly to all active SSE clients for that player.
    const clients = sseClients.get(discordId);
    if (!clients || clients.size === 0) return;
    const dataStr = `event: reward\ndata: ${JSON.stringify(summary)}\n\n`;
    clients.forEach(c => { try { c.res.write(dataStr); } catch (_) {} });
  }
  // Attach helper hooks onto serviceContext so other modules can reuse them.
  serviceContext._pushRewardToPlayer = pushRewardToPlayer;
  serviceContext._pushStreamPresence = (snapshot = getStreamPresenceSnapshot()) => {
    const dataStr = `event: stream_presence\ndata: ${JSON.stringify(snapshot)}\n\n`;
    streamPresenceClients.forEach((client) => {
      try { client.res.write(dataStr); } catch (_) {}
    });
  };
  if (discordClient) {
    discordClient.on("messageCreate", async (msg) => {
      const hasContent = msg.content || msg.embeds.length > 0 || msg.stickers.size > 0 || msg.attachments.size > 0;
      if (!hasContent) return;

      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);

      if (townChatBinding && msg.channelId === townChatBinding.channelId) {
        let content = msg.content || "";
        if (msg.stickers.size > 0) {
          const stickerUrls = [...msg.stickers.values()].map(s => `https://media.discordapp.net/stickers/${s.id}.png`);
          content = [content, ...stickerUrls].filter(Boolean).join(" ");
        }
        if (msg.attachments.size > 0) {
          const attachUrls = [...msg.attachments.values()].map(a => a.url);
          content = [content, ...attachUrls].filter(Boolean).join(" ");
        }
        if (msg.embeds.length > 0 && !content) content = "[Embedded content]";

        // Reply preview metadata.
        let replyTo = null;
        if (msg.reference?.messageId) {
          try {
            const replied = await msg.channel.messages.fetch(msg.reference.messageId);
            replyTo = {
              id: replied.id,
              author: replied.member?.displayName || replied.author.globalName || replied.author.username,
              content: (replied.content || "").slice(0, 80),
            };
          } catch (_) {}
        }

        const payload = {
          id: msg.id,
          author: msg.member?.displayName || msg.author.globalName || msg.author.username,
          avatar: msg.author.displayAvatarURL(),
          content: await resolveMentions(content, msg.guild),
          timestamp: msg.createdTimestamp,
          isBot: msg.author.bot,
          replyTo,
        };
        const dataStr = `data: ${JSON.stringify(payload)}\n\n`;
        sseClients.forEach(clients => clients.forEach(c => { try { c.res.write(dataStr); } catch (_) {} }));
      }
    });
  }

  // 5b. Viewer Profile — public, no auth required
  // Used by chat.html to look up a viewer's in-game level & title via OneComme platform ID.
  router.get("/api/chat/viewer-profile", async (req, res) => {
    try {
      const { platform, userId } = req.query;
      if (!platform || !userId) return res.json({ found: false });

      const player = await serviceContext.playerRepository.findByExternalId(platform, userId);
      if (!player) return res.json({ found: false });

      const progress = await serviceContext.progressRepository.findByPlayerId(player.discordId);
      if (!progress) return res.json({ found: false });

      const level = progress.level || 1;
      const titleEq = progress.equipment?.title_eq;
      const title = titleEq?.itemName || null;

      return res.json({ found: true, level, title, displayName: player.displayName });
    } catch (_) {
      return res.json({ found: false });
    }
  });

  // 6. SSE Stream
  router.get("/api/chat/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");  // Disable buffering on reverse proxies for SSE
    res.flushHeaders();

    // Optional token in query string lets us bind the SSE stream to a player.
    let discordId = null;
    try {
      const token = req.query.token || "";
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
        discordId = decoded.discordId || null;
      }
    } catch (_) {}

    const client = { res };
    streamPresenceClients.add(client);
    if (discordId) {
      if (!sseClients.has(discordId)) sseClients.set(discordId, new Set());
      sseClients.get(discordId).add(client);
    }

    try {
      res.write(`event: stream_presence\ndata: ${JSON.stringify(getStreamPresenceSnapshot())}\n\n`);
    } catch (_) {}

    const timer = setInterval(() => {
      res.write(":\n\n"); // Heartbeat comment
    }, 15000);

    req.on("close", () => {
      clearInterval(timer);
      streamPresenceClients.delete(client);
      if (discordId) {
        const s = sseClients.get(discordId);
        if (s) { s.delete(client); if (s.size === 0) sseClients.delete(discordId); }
      }
    });
  });

  router.get("/api/stream/presence", requireAuth, (req, res) => {
    res.json(ok(getStreamPresenceSnapshot()));
  });

  // 7. Poll notifications (fallback for Cloudflare/proxy that blocks SSE)
  router.get("/api/notifications/poll", requireAuth, (req, res) => {
    const discordId = req.playerRecord.discordId;
    const q = notifQueue.get(discordId) || [];
    notifQueue.set(discordId, []); // clear queue after polling
    res.json({ status: "ok", data: q });
  });

  // 8. Get Chat History
  router.get("/api/chat/history", requireAuth, async (req, res, next) => {
    try {
      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      
      if (!townChatBinding || !townChatBinding.channelId || !discordClient) {
        return res.json(ok([]));
      }
      
      const channel = discordClient.channels.cache.get(townChatBinding.channelId);
      if (!channel) return res.json(ok([]));
      
      const messages = await channel.messages.fetch({ limit: 50 });
      const history = await Promise.all([...messages.values()].map(async (msg) => {
        // Resolve missing guild member data on demand when cache misses.
        if (!msg.member && !msg.author.bot) {
          try { await channel.guild.members.fetch(msg.author.id); } catch (_) {}
        }
        let content = msg.content || "";
        if (msg.stickers.size > 0) {
          const stickerUrls = [...msg.stickers.values()].map(s => `https://media.discordapp.net/stickers/${s.id}.png`);
          content = [content, ...stickerUrls].filter(Boolean).join(" ");
        }
        if (msg.attachments.size > 0) {
          const attachUrls = [...msg.attachments.values()].map(a => a.url);
          content = [content, ...attachUrls].filter(Boolean).join(" ");
        }
        if (msg.embeds.length > 0 && !content) content = "[Embedded content]";

        let replyTo = null;
        if (msg.reference?.messageId) {
          const replied = messages.get(msg.reference.messageId);
          if (replied) {
            replyTo = {
              id: replied.id,
              author: replied.member?.displayName || replied.author.globalName || replied.author.username,
              content: (replied.content || "").slice(0, 80),
            };
          }
        }

        const resolvedContent = await resolveMentions(content, channel.guild);
        return {
          id: msg.id,
          author: msg.member?.displayName || msg.author.globalName || msg.author.username,
          avatar: msg.author.displayAvatarURL(),
          content: resolvedContent,
          timestamp: msg.createdTimestamp,
          isBot: msg.author.bot,
          replyTo,
        };
      }));
      res.json(ok(history.reverse()));
    } catch (err) {
      next(err);
    }
  });

  // 7b. Get guild stickers & emojis for chat picker
  router.get("/api/chat/expressions", requireAuth, async (req, res, next) => {
    try {
      const guildId = require("../../config").discord.guildId;
      console.log("[expressions] guildId:", guildId, "| discordClient ready:", !!discordClient?.isReady?.());
      if (!guildId || !discordClient) return res.json(ok({ stickers: [], emojis: [] }));

      const guild = discordClient.guilds.cache.get(guildId)
        || await discordClient.guilds.fetch(guildId).catch((e) => { console.error("[expressions] guild fetch error:", e.message); return null; });
      console.log("[expressions] guild found:", !!guild, "| name:", guild?.name);
      if (!guild) return res.json(ok({ stickers: [], emojis: [] }));

      const [fetchedEmojis, fetchedStickers] = await Promise.all([
        guild.emojis.fetch().catch((e) => { console.error("[expressions] emoji fetch error:", e.message); return guild.emojis.cache; }),
        guild.stickers.fetch().catch((e) => { console.error("[expressions] sticker fetch error:", e.message); return guild.stickers.cache; }),
      ]);
      console.log("[expressions] emojis:", fetchedEmojis.size, "| stickers:", fetchedStickers.size);

      const stickers = [...fetchedStickers.values()].map(s => ({
        id: s.id,
        name: s.name,
        // format: 1=PNG, 2=APNG, 3=Lottie, 4=GIF
        url: s.format === 4
          ? `https://media.discordapp.net/stickers/${s.id}.gif`
          : `https://media.discordapp.net/stickers/${s.id}.png`,
        isLottie: s.format === 3,
      }));

      const emojis = [...fetchedEmojis.values()].map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`,
        code: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
      }));

      res.json(ok({ stickers, emojis }));
    } catch (err) {
      next(err);
    }
  });

  // 8. Get Shop Items
  router.get("/api/shop/items", requireAuth, async (req, res, next) => {
    try {
      const items = await serviceContext.shopService.listItems({ includeDisabled: false });
      res.json(ok(items));
    } catch (err) {
      next(err);
    }
  });

  // 9. Buy Shop Item
  router.post("/api/shop/buy/:itemId", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const itemId = req.params.itemId;

      // Read the player's guild roles so tier-gated shop items can be validated.
      let memberRoleIds = [];
      try {
        const guildId = require("../../config").discord.guildId;
        if (guildId && discordClient) {
          const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch({ user: discordId, force: false }).catch(() => null);
            if (member) memberRoleIds = [...member.roles.cache.keys()];
          }
        }
      } catch (_) {}

      const result = await serviceContext.shopService.purchase(discordId, displayName, itemId, memberRoleIds);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  });

  // 10. Get Combat Zones Status
  router.get("/api/combat/zones", requireAuth, async (req, res, next) => {
    try {
      const keys = ["normal", "mid"];
      const results = await Promise.all(keys.map(async (key) => {
        const [state, monsters] = await Promise.all([
          serviceContext.monsterService.getState(key),
          serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: key })
        ]);
        
        let activeMonster = monsters.find(m => m.seq === state.activeMonsterSeq);
        if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

        const dmgMap = state.damageMap || {};
        const damageLeaderboard = Object.values(dmgMap)
          .sort((a, b) => b.damage - a.damage)
          .slice(0, 10);

        const cooldown = playerBattleCooldowns.get(req.playerRecord.discordId);
        const nextBattleAt = (cooldown && cooldown.nextBattleAt > Date.now()) ? cooldown.nextBattleAt : null;

        return {
          zone: key,
          monsterId: activeMonster?.id || null,
          monsterName: activeMonster?.name || "Unknown",
          monsterImageUrl: activeMonster?.imageUrl || null,
          monsterLevel: activeMonster?.level || 0,
          expReward: activeMonster?.expReward || 0,
          goldReward: activeMonster?.goldReward || 0,
          drops: (activeMonster?.drops || []).map(d => d.itemName),
          currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
          maxHp: activeMonster?.calc?.maxHp || 0,
          participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
          activeMonsterSeq: state.activeMonsterSeq,
          damageLeaderboard,
          nextBattleAt,
        };
      }));
      res.json(ok(results));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/viewer/battle-config", async (_req, res, next) => {
    try {
      const configData = await serviceContext.battleConfigService.getViewerConfig();
      res.json(ok(configData));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/viewer/snapshot", async (_req, res, next) => {
    try {
      const keys = ["normal", "mid"];
      const zones = await Promise.all(keys.map(async (key) => {
        const [state, monsters] = await Promise.all([
          serviceContext.monsterService.getState(key),
          serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: key })
        ]);

        let activeMonster = monsters.find((m) => m.seq === state.activeMonsterSeq);
        if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

        const dmgMap = state.damageMap || {};
        const damageLeaderboard = await Promise.all(
          Object.entries(dmgMap)
            .sort(([, a], [, b]) => b.damage - a.damage)
            .slice(0, 10)
            .map(async ([pid, entry]) => {
              const [player, progress] = await Promise.all([
                serviceContext.playerRepository?.findByDiscordId(pid).catch(() => null),
                serviceContext.progressRepository?.findByPlayerId(pid).catch(() => null),
              ]);

              let avatarUrl = null;
              if (discordClient) {
                try {
                  const discordUser = await discordClient.users.fetch(pid, { force: false });
                  avatarUrl = discordUser.displayAvatarURL({ size: 128, extension: 'png' });
                } catch (_) {}
              }

              return {
                discordId: pid,
                name: entry?.name || player?.displayName || pid,
                damage: entry?.damage || 0,
                damageTaken: entry?.taken || 0,
                weaponType: progress?.equipment?.weapon?.weaponType || null,
                offhandWeaponType: progress?.equipment?.shield?.weaponType || null,
                weaponImageUrl: progress?.equipment?.weapon?.imageUrl || null,
                avatarUrl,
              };
            })
        );

        return {
          zone: key,
          monsterId: activeMonster?.id || null,
          monsterName: activeMonster?.name || "??堊?",
          monsterImageUrl: activeMonster?.imageUrl || null,
          monsterLevel: activeMonster?.level || 0,
          expReward: activeMonster?.expReward || 0,
          goldReward: activeMonster?.goldReward || 0,
          drops: (activeMonster?.drops || []).map((d) => d.itemName),
          currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
          maxHp: activeMonster?.calc?.maxHp || 0,
          participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
          activeMonsterSeq: state.activeMonsterSeq,
          damageLeaderboard,
          nextBattleAt: null,
        };
      }));

      res.json(ok({
        zones,
        roundMs: ROUND_MS,
        streamPresence: getStreamPresenceSnapshot(),
        refreshedAt: new Date().toISOString(),
      }));
    } catch (err) {
      next(err);
    }
  });

  // 11. Quick Battle
  router.post("/api/combat/quick-battle", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const zoneKey = req.body.zone === "mid" ? "mid" : "normal";

      // Reject requests while the previous battle animation cooldown is still active.
      const cd = playerBattleCooldowns.get(discordId);
      if (cd && cd.nextBattleAt > Date.now()) {
        const secsLeft = Math.ceil((cd.nextBattleAt - Date.now()) / 1000);
        return res.status(429).json({ status: "error", message: `battle cooldown active, retry in ${secsLeft}s` });
      }
      
      const [stateRaw, monsters] = await Promise.all([
        serviceContext.monsterService.getState(zoneKey),
        serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey })
      ]);
      let state = stateRaw;
      
      if (!monsters.length) {
        return res.status(400).json({ status: "error", message: "No enabled monster in this zone." });
      }

      let monster = monsters.find(m => m.seq === state.activeMonsterSeq);
      if (!monster) {
        monster = monsters[0];
        const initHp = monster.calc.maxHp;
        await serviceContext.monsterService.saveState({ ...state, activeMonsterSeq: monster.seq, currentHp: initHp }, zoneKey);
        state = { ...state, activeMonsterSeq: monster.seq, currentHp: initHp };
      }
      
      const monsterHpInitial = state.currentHp != null ? state.currentHp : monster.calc.maxHp;

      // Check level
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const playerLevel = progress?.level ?? 1;
      if (zoneKey === "mid" && playerLevel < 10) {
        return res.status(400).json({ status: "error", message: `mid zone requires level 10 (current: Lv.${playerLevel})` });
      }

      // Check and deduct entry fee
      if (monster.entryFee > 0) {
        const wallet = await serviceContext.walletRepository.findByPlayerId(discordId);
        const gold = wallet?.gold ?? 0;
        if (gold < monster.entryFee) {
          return res.status(400).json({ status: "error", message: `gold not enough: need ${monster.entryFee}, have ${gold}` });
        }
        await serviceContext.rewardService.grantCurrency({
          discordId, displayName, currencyType: "gold",
          amount: -monster.entryFee, source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE, operator: "monster_zone"
        });
      }

      // Calc player stats（永遠從 DB 讀取最新 effects，不使用 snapshot 裡的舊值）
      const { calcPlayerStats } = require("../../shared/combatStats");
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, serviceContext.itemRepository);
      const pStats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], progress?.inventory || []);

      // ── 治療師光環系統 ──
      // 檢查玩家是否裝備治療師徽章
      const jobEq = equipped.job_eq || null;
      const jobId = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
      const jobName = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
      const isHealer = jobEq && (jobId.includes("healer") || jobName.includes("治療"));

      // 讀取最新的怪物狀態以更新光環記錄
      const freshStateForAura = await serviceContext.monsterService.getState(zoneKey);

      let stateForCombat = freshStateForAura;
      let partyEffects = [];

      if (isHealer) {
        // 治療師進入：收集 party 效果並記錄光環
        const partyEffs = collectEquipmentEffects(equipped, "passive", { equipped, inventory: progress?.inventory || [] })
          .filter(e => e.target === "party");

        const auraState = {
          ...freshStateForAura,
          activeHealerAura: {
            discordId,
            displayName,
            effects: partyEffs
          }
        };
        await serviceContext.monsterService.saveState(auraState, zoneKey);
        stateForCombat = auraState;
        partyEffects = partyEffs;
      } else if (freshStateForAura.activeHealerAura?.discordId === discordId) {
        // 同一玩家沒穿治療師徽章再次進入 → 清除光環
        const clearedState = {
          ...freshStateForAura,
          activeHealerAura: null
        };
        await serviceContext.monsterService.saveState(clearedState, zoneKey);
        stateForCombat = clearedState;
        partyEffects = [];
      } else {
        // 其他玩家：享受光環效果（如果存在）
        const aura = freshStateForAura.activeHealerAura;
        partyEffects = (aura?.effects || []).map(e => ({ ...e, sourceName: aura?.displayName || null }));
        stateForCombat = freshStateForAura;
      }

      // ── 為怪物自動裝備自己的卡片 ──
      let monsterEquipped = {};
      try {
        const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
        const db = await getMongoDb();
        const monsterCard = await db.collection("items").findOne({
          name: { $regex: monster.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '卡' },
          equipSlot: 'special'
        });
        if (monsterCard) {
          monsterEquipped.special_1 = monsterCard;
        }
      } catch (e) {
        // 如果無法取得怪物卡片，繼續進行戰鬥
      }

      const { runCombatLoop } = require("../../shared/combatLoop");
      const { outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp } =
        runCombatLoop(pStats, monster.calc, monster.name, monsterHpInitial, undefined, {
          equipped,
          inventory: progress?.inventory || [],
          partyEffects,
          monsterEquipped
        });
      const totalTaken = Math.max(0, (pStats.maxHp || 0) - Math.max(0, finalPlayerHp));

      // 蝯?
      const { handleMonsterKill, _republishPanel, MAX_ROUNDS } = require("../../bot/handlers/monsterZoneHandlers");
      let rewardLines = [];
      let mHp = finalMonsterHp;
      const currentParticipants = Array.isArray(stateForCombat.participants) ? stateForCombat.participants : [];

      if (outcome === "win") {
        mHp = 0;
        // Ensure this player is included in participants and damage map before kill handling.
        const stateWithMe = {
          ...stateForCombat,
          participants: [...new Set([...currentParticipants, discordId])],
          damageMap: {
            ...(stateForCombat.damageMap || {}),
            [discordId]: {
              name: displayName,
              damage: (stateForCombat.damageMap?.[discordId]?.damage || 0) + totalDamage,
              taken: (stateForCombat.damageMap?.[discordId]?.taken || 0) + totalTaken,
            }
          }
        };
        const sessionPayload = { monsterName: monster.name, entryFee: monster.entryFee };
        rewardLines = await handleMonsterKill({ discordId, displayName, session: sessionPayload, monster, state: stateWithMe, totalDamage, zoneKey });
      } else {
        mHp = Math.max(0, mHp);
        let damageMap = {};
        try {
          const freshState = await serviceContext.monsterService.getState(zoneKey);
          const prev = freshState.damageMap || {};
          damageMap = {
            ...prev,
            [discordId]: {
              name: displayName,
              damage: (prev[discordId]?.damage || 0) + totalDamage,
              taken: (prev[discordId]?.taken || 0) + totalTaken,
            }
          };
          // Refresh participants from the latest state to avoid clobbering concurrent joins.
          const updatedParticipants = [...new Set([...(Array.isArray(freshState.participants) ? freshState.participants : []), discordId])];
          await serviceContext.monsterService.saveState({ ...freshState, currentHp: mHp, damageMap, participants: updatedParticipants }, zoneKey);
        } catch (e) {
          await serviceContext.monsterService.saveState({ ...state, currentHp: mHp }, zoneKey);
        }

        if (outcome === "lose") {
          rewardLines = [`You were defeated by **${monster.name}**!`, monster.entryFee > 0 ? "Entry fee consumed." : "Try again next time."];
        } else {
          rewardLines = [`Survived ${MAX_ROUNDS} rounds and forced the monster to retreat.`];
        }
        rewardLines.push("Monster battle state has been updated in the zone panel.");

        // update panel
        _republishPanel(serviceContext, zoneKey, monster, mHp, currentParticipants.length + 1, damageMap).catch(() => {});
      }

      if (progress && Array.isArray(progress.activeEffects) && progress.activeEffects.length > 0) {
        const nextActiveEffects = decrementActiveEffects(progress.activeEffects, "battle", 1);
        if (nextActiveEffects.length !== progress.activeEffects.length) {
          progress.activeEffects = nextActiveEffects;
          progress.updatedAt = new Date().toISOString();
          await serviceContext.progressRepository.save(progress).catch(() => {});
        }
      }

      // Weekly quest progression is updated after each battle result.
      try {
        await serviceContext.weeklyQuestService.recordProgress(discordId, "battle_count", 1);
        if (outcome === "win") {
          await serviceContext.weeklyQuestService.recordProgress(discordId, "battle_win", 1);
        }
        await serviceContext.weeklyQuestService.recordProgress(discordId, "damage_total", totalDamage);
      } catch (e) {
        console.error("[WeeklyQuest] recordProgress error:", e.message);
      }

      // Cooldown duration matches the client-side animation timeline.
      const animDurationMs = roundLogs.length * ROUND_MS + 2000;
      const nextBattleAt = Date.now() + animDurationMs;
      playerBattleCooldowns.set(discordId, { zone: zoneKey, nextBattleAt });
      // Clean up the cooldown map after the window has safely expired.
      setTimeout(() => {
        const entry = playerBattleCooldowns.get(discordId);
        if (entry && entry.nextBattleAt <= Date.now()) playerBattleCooldowns.delete(discordId);
      }, animDurationMs + 5000);

      res.json(ok({
        outcome,
        monsterName: monster.name,
        logs: roundLogs,
        rewardLines,
        rewardSummary: rewardLines._summary || null,
        totalDamage,
        finalPlayerHp: Math.max(0, finalPlayerHp),
        finalMonsterHp: Math.max(0, mHp),
        nextBattleAt,
      }));

    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 寶石強化相關 endpoints
  // ──────────────────────────────────────────────────

  // GET /api/me/enhance/:itemUuid - 查詢某件裝備的強化信息（寶石強化）
  router.get("/api/me/enhance/:itemUuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const info = await serviceContext.enhanceService.getEnhanceInfo(discordId, req.params.itemUuid);
      if (!info) {
        return res.status(400).json({ error: "該道具無法強化" });
      }

      res.json(ok(info, "強化信息"));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/me/enhance/:itemUuid - 強化裝備（寶石強化）
  router.post("/api/me/enhance/:itemUuid", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const result = await serviceContext.enhanceService.enhanceEquipment(discordId, req.params.itemUuid);
      res.json(ok(result, result.message));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerAppRoutes };



