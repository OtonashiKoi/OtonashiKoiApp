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
        const params = new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: "http://localhost:5173/"
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
          attributes: attrs
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
          // 在頻道中模擬發言：[Web] 玩家名: 訊息內容
          await channel.send(`[Web] **${displayName}**: ${message}`);
        } else {
           console.warn(`[PlayerApp] 找不到 Town Chat 頻道 (ID: ${townChatBinding.channelId})，但設定已綁定`);
        }
      }

      res.json(ok({ status: "sent", message }));
    } catch (err) {
      next(err);
    }
  });

  // 5. SSE Client Management
  // 輔助函式：解析 Discord 提到的名稱
  const resolveMentions = async (text) => {
    if (!text || typeof text !== "string") return text;
    const mentionRegex = /<@!?(\d+)>/g;
    const matches = [...text.matchAll(mentionRegex)];
    let resolvedText = text;

    for (const match of matches) {
      const userId = match[1];
      try {
        const player = await serviceContext.playerRepository.findByPlayerId(userId);
        if (player) {
          resolvedText = resolvedText.replace(match[0], `[@${player.displayName}]`);
        }
      } catch (err) {
        // 找不到則維持原樣
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
          content: await resolveMentions(content),
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
        const resolvedContent = await resolveMentions(content);
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
      const result = await serviceContext.shopService.purchase(discordId, displayName, itemId);
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

        return {
          zone: key,
          monsterName: activeMonster?.name || "未知",
          currentHp: state.currentHp !== undefined ? state.currentHp : (activeMonster?.calc?.maxHp || 0),
          maxHp: activeMonster?.calc?.maxHp || 0,
          participantCount: Array.isArray(state.participants) ? state.participants.length : 0,
          activeMonsterSeq: state.activeMonsterSeq
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
