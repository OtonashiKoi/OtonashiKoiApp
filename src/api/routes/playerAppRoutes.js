const { Router } = require("express");
const jwt = require("jsonwebtoken");
const { ok } = require("../../shared/response");
const { CURRENCY_SOURCES } = require("../../shared/sources");

function createPlayerAppRoutes(serviceContext, discordClient) {
  const router = Router();

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

      // 為了方便本機開發測試，如果 code 以 "mock:" 開頭則一律放行
      if (code.startsWith("mock:")) {
        console.log("[PlayerApp] 使用開發模式 Mock 登入");
        discordId = code.replace("mock:", "");
        if (discordId.length < 5) discordId = "1450019975031951370"; // 預設拿資料庫第一位玩家測試
      } else {
        // 真實的 Discord OAuth2 交換 (會需要 Node 18+ 的 fetch)
        if (!process.env.DISCORD_CLIENT_SECRET) {
          return res.status(500).json({ status: "error", message: "後端尚未設定 DISCORD_CLIENT_SECRET，無法驗證真實的 Discord 登入" });
        }
        // redirect_uri 必須與前端發起 OAuth 時一致，由前端傳入
        const { redirect_uri } = req.body;
        if (!redirect_uri) {
          return res.status(400).json({ status: "error", message: "缺少 redirect_uri 參數" });
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
           return res.status(400).json({ status: "error", message: `Discord 驗證失敗: ${tokenData.error_description || tokenData.error}` });
        }

        const userRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        discordId = userData.id;
        displayName = userData.global_name || userData.username;
      }

      // ── 驗證是否為伺服器成員 ──
      const guildId = require("../../config").discord.guildId;
      if (guildId && discordClient && !code.startsWith("mock:")) {
        try {
          const guild = discordClient.guilds.cache.get(guildId)
            || await discordClient.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
            if (!member) {
              return res.status(403).json({ status: "error", code: "NOT_GUILD_MEMBER", message: "你還不是伺服器成員，請先加入社群！" });
            }
            // 使用伺服器內的暱稱
            displayName = member.displayName || displayName;
          }
        } catch (err) {
          console.warn("[PlayerApp] Guild membership check failed, skipping:", err.message);
        }
      }

      // 確保玩家資料存在 (與 Discord 面板創角邏輯一致)
      await serviceContext.playerService.ensurePlayer(discordId, displayName);

      // 核發我們自己系統的 JWT
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
      
      const [profileResult, walletResult] = await Promise.all([
        serviceContext.playerService.getProfile(discordId, displayName),
        serviceContext.walletService.getWalletByDiscordId(discordId, displayName)
      ]);

      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      
      // Calculate missing EXP
      const isMaxLevel = (progress?.level || 1) >= 99; // Assume 99 or use consts if exported

      res.json(ok({
        player: profileResult.player,
        wallet: walletResult.wallet,
        progress: {
          level: progress?.level || 1,
          jobLevel: progress?.jobLevel || 1,
          job: progress?.job || "Novice",
          exp: progress?.exp || 0,
          statusPoints: progress?.statusPoints || 0,
          playerTier: progress?.playerTier || "E",
          attributes: attrs,
          equipment: progress?.equipment || {}
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
      const result = await serviceContext.shopService.equipItem(discordId, uuid);
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

  // 4. Send Chat Lobby Message
  router.post("/api/chat/lobby", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { message } = req.body;
      
      if (!message || message.trim() === "") {
        throw new Error("Message cannot be empty");
      }

      // 取得系統設定中的 town_chat 頻道 ID
      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      
      if (townChatBinding && townChatBinding.channelId && discordClient) {
        const channel = discordClient.channels.cache.get(townChatBinding.channelId);
        if (channel) {
          // 取得玩家的 Discord 頭像
          let avatarURL = null;
          try {
            const discordUser = await discordClient.users.fetch(discordId, { force: false });
            avatarURL = discordUser.displayAvatarURL({ size: 128, extension: 'png' });
          } catch (_) {}

          // 取得或建立 Webhook，讓訊息以玩家名字和頭像發送
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
            // Webhook 無法建立時回退到 Bot 發送
            await channel.send(`**${displayName}**: ${message}`);
          }
        } else {
          console.warn(`[PlayerApp] 找不到 Town Chat 頻道 (ID: ${townChatBinding.channelId})`);
        }
      }

      res.json(ok({ status: "sent", message }));
    } catch (err) {
      next(err);
    }
  });

  // 5. SSE Client Management
  // 輔助函式：解析 Discord 提到的名稱
  const resolveMentions = async (text, guild = null) => {
    if (!text || typeof text !== "string") return text;
    const mentionRegex = /<@!?(\d+)>/g;
    const matches = [...text.matchAll(mentionRegex)];
    let resolvedText = text;

    // 定義一個簡單的局部緩存，防止同一次解析中多次 fetch 同一個用戶
    const localCache = {};

    for (const match of matches) {
      const userId = match[1];
      if (localCache[userId]) {
        resolvedText = resolvedText.replace(match[0], `[@${localCache[userId]}]`);
        continue;
      }

      try {
        let playerName = null;
        
        // 1. 如果有傳入 Guild，優先從 Server Member 中抓取「伺服器暱稱」
        if (guild) {
          try {
            const member = await guild.members.fetch(userId);
            if (member) playerName = member.displayName;
          } catch (e) { /* 繼續往下找 */ }
        }

        // 2. 從資料庫找
        if (!playerName) {
          const player = await serviceContext.playerRepository.findByDiscordId(userId);
          if (player) {
            playerName = player.displayName;
          } else if (serviceContext.progressRepository) {
            const progress = await serviceContext.progressRepository.findByPlayerId(userId);
            if (progress) playerName = progress.displayName;
          }
        }

        // 3. 全局 Discord API
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
          console.warn(`[Chat] 無法解析 ID 為 ${userId} 的名稱`);
        }
      } catch (err) {
        console.error(`[Chat] 解析提及 ${userId} 時發生錯誤:`, err);
      }
    }
    return resolvedText;
  };

  const sseClients = new Set();
  if (discordClient) {
    discordClient.on("messageCreate", async (msg) => {
      if (!msg.content && msg.embeds.length === 0) return;
      
      const layout = await serviceContext.channelLayoutRepository.get();
      const townChatBinding = layout.discord.bindings.find(b => b.featureKey === "town_chat" && b.enabled);
      
      if (townChatBinding && msg.channelId === townChatBinding.channelId) {
        let content = msg.content;
        if (msg.embeds.length > 0 && !content) content = "傳送了一個面板";
        
        const payload = {
          id: msg.id,
          author: msg.author.username,
          avatar: msg.author.displayAvatarURL(),
          content: await resolveMentions(content, msg.guild),
          timestamp: msg.createdTimestamp,
          isBot: msg.author.bot
        };
        const dataStr = `data: ${JSON.stringify(payload)}\n\n`;
        sseClients.forEach(client => client.res.write(dataStr));
      }
    });
  }

  // 6. SSE Stream
  router.get("/api/chat/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders(); 

    const client = { res };
    sseClients.add(client);
    
    const timer = setInterval(() => {
      res.write(":\n\n"); // Heartbeat comment
    }, 15000);

    req.on("close", () => {
      clearInterval(timer);
      sseClients.delete(client);
    });
  });

  // 7. Get Chat History
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
        let content = msg.content;
        if (msg.embeds.length > 0 && !content) content = "傳送了一個面板";
        const resolvedContent = await resolveMentions(content, channel.guild);
        return {
          id: msg.id,
          author: msg.author.username,
          avatar: msg.author.displayAvatarURL(),
          content: resolvedContent,
          timestamp: msg.createdTimestamp,
          isBot: msg.author.bot
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

      // 從 Bot 取得玩家在 Guild 的身分組，供 allowedTiers 驗證
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

        return {
          zone: key,
          monsterName: activeMonster?.name || "未知",
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
        };
      }));
      res.json(ok(results));
    } catch (err) {
      next(err);
    }
  });

  // 11. Quick Battle
  router.post("/api/combat/quick-battle", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const zoneKey = req.body.zone === "mid" ? "mid" : "normal";
      
      const [stateRaw, monsters] = await Promise.all([
        serviceContext.monsterService.getState(zoneKey),
        serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey })
      ]);
      let state = stateRaw;
      
      if (!monsters.length) {
        return res.status(400).json({ status: "error", message: "目前沒有啟用中的怪物" });
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
        return res.status(400).json({ status: "error", message: `中級區需要等級 10 以上！目前 Lv.${playerLevel}` });
      }

      // Check and deduct entry fee
      if (monster.entryFee > 0) {
        const wallet = await serviceContext.walletRepository.findByPlayerId(discordId);
        const gold = wallet?.gold ?? 0;
        if (gold < monster.entryFee) {
          return res.status(400).json({ status: "error", message: `金幣不足！需要 ${monster.entryFee} 🪙，目前 ${gold} 🪙` });
        }
        await serviceContext.rewardService.grantCurrency({
          discordId, displayName, currencyType: "gold",
          amount: -monster.entryFee, source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE, operator: "monster_zone"
        });
      }

      // Calc player stats
      const { calcPlayerStats } = require("../../shared/combatStats");
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = progress?.equipment || {};
      const pStats = calcPlayerStats(attrs, equipped);

      let mHp = monsterHpInitial;
      let pHp = pStats.maxHp;
      let outcome = null;
      let totalDamage = 0;
      let round = 1;
      const MAX_ROUNDS = 30;
      const roundLogs = [];

      const wt = pStats.weaponType || null;
      const atkVerbs = !wt ? ["揮拳猛擊", "飛腿踢出", "怒拳轟擊"] : 
        (wt.startsWith("staff")) ? ["施展魔法", "釋放法術"] :
        (wt === "bow") ? ["拉弓射擊", "急速連射"] : ["快速刺出", "連環割砍", "揮劍斬擊"];
      const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const rollDmg = (base) => Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));

      // Simulation Loop
      while (round <= MAX_ROUNDS && outcome === null) {
        const log = [`**【第 ${round} 回合】**`];
        
        for (let a = 0; a < (pStats.attackCount || 1) && outcome === null; a++) {
          const hitChance = pStats.hit - monster.calc.dodge;
          if (pStats.absoluteHit || Math.random() * 100 < hitChance) {
            let dmg = rollDmg(Math.max(1, pStats.atk - monster.calc.def));
            const isCrit = Math.random() * 100 < pStats.crit;
            if (isCrit) dmg = Math.round(dmg * 1.5);
            mHp -= dmg;
            totalDamage += dmg;
            log.push(`⚔️ ${isCrit ? "✨**會心一擊**！" : ""}${rand(atkVerbs)}，對 ${monster.name} 造成 **${dmg}** 傷害！(怪剩 ${Math.max(0, mHp)})`);
            
            if (mHp <= 0) { outcome = "win"; break; }
            if (outcome === null && Math.random() * 100 < pStats.combo) {
              let cdmg = rollDmg(Math.max(1, pStats.atk - monster.calc.def));
              mHp -= cdmg;
              totalDamage += cdmg;
              log.push(`⚡ **連擊！** 追加造成 **${cdmg}** 傷害！(怪剩 ${Math.max(0, mHp)})`);
              if (mHp <= 0) { outcome = "win"; break; }
            }
          } else {
            log.push(`💨 ${monster.name} 身形一閃，你的攻擊落空了！`);
          }
        }

        if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

        for (let ma = 0; ma < (pStats.monsterAttackCount || 1) && outcome === null; ma++) {
          const monsterHitChance = monster.calc.hit - pStats.dodge;
          if (Math.random() * 100 < monsterHitChance) {
            const dmg = rollDmg(Math.max(1, monster.calc.atk - pStats.def));
            pHp -= dmg;
            log.push(`💥 ${monster.name} 猛力一擊，造成 **${dmg}** 傷害！(你剩 ${Math.max(0, pHp)})`);
            if (pHp <= 0) { outcome = "lose"; break; }
          } else {
            log.push(`🛡️ ${monster.name} 猛撲而來，你及時迴避！`);
          }
        }
        
        roundLogs.push(log.join("\n"));
        if (outcome === "lose") break;
        round++;
      }
      
      if (outcome === null) outcome = "timeout";

      // 結算
      const { handleMonsterKill, _republishPanel } = require("../../bot/handlers/monsterZoneHandlers");
      let rewardLines = [];
      const currentParticipants = Array.isArray(state.participants) ? state.participants : [];

      if (outcome === "win") {
        mHp = 0;
        const sessionPayload = { monsterName: monster.name, entryFee: monster.entryFee };
        rewardLines = await handleMonsterKill({ discordId, displayName, session: sessionPayload, monster, state, totalDamage, zoneKey });
      } else {
        mHp = Math.max(0, mHp);
        let damageMap = {};
        try {
          const freshState = await serviceContext.monsterService.getState(zoneKey);
          const prev = freshState.damageMap || {};
          damageMap = { ...prev, [discordId]: { name: displayName, damage: (prev[discordId]?.damage || 0) + totalDamage } };
          await serviceContext.monsterService.saveState({ ...freshState, currentHp: mHp, damageMap }, zoneKey);
        } catch (e) {
          await serviceContext.monsterService.saveState({ ...state, currentHp: mHp }, zoneKey);
        }

        if (outcome === "lose") {
          rewardLines = [`你被 **${monster.name}** 擊倒了！`, monster.entryFee > 0 ? "入場費已損失。" : "下次加油！"];
        } else {
          rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。`];
        }
        // update panel
        _republishPanel(serviceContext, zoneKey, monster, mHp, currentParticipants.length, damageMap).catch(() => {});
      }

      res.json(ok({
        outcome,
        monsterName: monster.name,
        logs: roundLogs,
        rewardLines,
        totalDamage,
        finalPlayerHp: Math.max(0, pHp),
        finalMonsterHp: Math.max(0, mHp)
      }));

    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerAppRoutes };
