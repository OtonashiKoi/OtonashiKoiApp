const { Router } = require("express");
const jwt = require("jsonwebtoken");
const config = require("../../config");
const { ok } = require("../../shared/response");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { getSnapshot: getStreamPresenceSnapshot } = require("../../services/stream/streamPresence");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
const { isEffectConditionMet, decrementActiveEffects, collectEquipmentEffects, mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { scaleSupportPartyEffects } = require("../../shared/supportAuraScaling");
const { ALL_ZONE_KEYS, normalizeZone, checkZoneLevelRequirementWithBinding, zoneToFeatureKey, getZoneDefaultEntryFee } = require("../../shared/zones");
const { isOnlyDTierEquipped } = require("../../shared/combatStats");

// Track per-player battle cooldowns.
// Cooldown duration matches battle animation time: round logs * 700ms + 2s buffer.
const playerBattleCooldowns = new Map();

// 每回合動畫長度（ms）。可用 env `ROUND_MS` 覆寫。預設為 700 * 0.8
const ROUND_MS = Number(process.env.ROUND_MS || Math.round(700 * 0.8));

// 與 Discord 戰鬥相同的低階區戰力同步規則。
const ZONE_DAMAGE_SYNC_RULES = {
  beginner: { maxHpRatioPerBattle: 0.30 },
  normal: { maxHpRatioPerBattle: 0.45 }
};
const DAMAGE_SYNC_NOTICE = "套用戰力同步：高階裝備與效果會暫時壓制到該區合理範圍。";

function applyZoneDamageSync(zoneKey, startMonsterHp, monsterMaxHp, rawDamage, rawFinalMonsterHp, rawOutcome) {
  const raw = Math.max(0, Math.round(Number(rawDamage || 0)));
  const startHp = Math.max(0, Math.round(Number(startMonsterHp || 0)));
  const rawFinalHp = Math.max(0, Math.round(Number(rawFinalMonsterHp ?? Math.max(0, startHp - raw))));
  const rule = ZONE_DAMAGE_SYNC_RULES[zoneKey];

  if (!rule || raw <= 0) {
    return {
      damage: raw,
      monsterHp: rawFinalHp,
      outcome: rawOutcome,
      applied: false,
      notice: null
    };
  }

  const maxHp = Math.max(1, Math.round(Number(monsterMaxHp || startHp || 1)));
  const cap = Math.max(1, Math.round(maxHp * Number(rule.maxHpRatioPerBattle || 1)));
  const damage = Math.min(raw, cap, startHp);
  const monsterHp = Math.max(0, startHp - damage);
  const outcome = rawOutcome === "lose" ? "lose" : (monsterHp <= 0 ? "win" : "timeout");
  const applied = damage < raw;

  return {
    damage,
    monsterHp,
    outcome,
    applied,
    notice: applied ? `${DAMAGE_SYNC_NOTICE} 本次有效傷害 ${damage} / 原始傷害 ${raw}。` : DAMAGE_SYNC_NOTICE
  };
}

function createPlayerAppRoutes(serviceContext, discordClient) {
  const router = Router();
  const STREAM_AUTH_STATE_TTL = "15m";
  const DISCORD_AUTH_STATE_TTL = "15m";

  function getPublicBaseUrl(req = null) {
    const configured = String(config.api?.publicBaseUrl || "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    if (req?.get && req?.protocol) {
      const host = req.get("host");
      if (host) return `${req.protocol}://${host}`.replace(/\/+$/, "");
    }
    return `http://localhost:${config.api?.port || 5566}`;
  }

  function signStreamAuthState(discordId) {
    return jwt.sign(
      { discordId: String(discordId || "").trim() },
      config.streamAuth?.stateSecret || process.env.JWT_SECRET || "stream-auth-secret",
      { expiresIn: STREAM_AUTH_STATE_TTL }
    );
  }

  function verifyStreamAuthState(token) {
    return jwt.verify(
      String(token || ""),
      config.streamAuth?.stateSecret || process.env.JWT_SECRET || "stream-auth-secret"
    );
  }

  function signDiscordAuthState(payload) {
    return jwt.sign(
      {
        discordId: String(payload?.discordId || "").trim(),
        discordName: String(payload?.discordName || "").trim(),
        purpose: "discord-binding-audit"
      },
      process.env.JWT_SECRET || "super-secret-jwt-key",
      { expiresIn: DISCORD_AUTH_STATE_TTL }
    );
  }

  function verifyDiscordAuthState(token) {
    return jwt.verify(
      String(token || ""),
      process.env.JWT_SECRET || "super-secret-jwt-key"
    );
  }

  function htmlEscape(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderAuthResultPage(title, lines, buttons = []) {
    const buttonHtml = buttons.map((btn) => {
      const href = htmlEscape(btn.href);
      const label = htmlEscape(btn.label);
      return `<a class="btn ${htmlEscape(btn.kind || "primary")}" href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    }).join("");
    const lineHtml = lines.map((line) => `<p>${htmlEscape(line)}</p>`).join("");
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${htmlEscape(title)}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1220;color:#f5f7ff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:760px;width:100%;background:#171b2c;border:1px solid #2b3350;border-radius:18px;padding:24px 24px 20px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
  h1{font-size:26px;margin:0 0 14px}
  p{margin:8px 0;line-height:1.7;color:#d7defc}
  .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700}
  .btn.primary{background:#5b67ff;color:#fff}
  .btn.secondary{background:#20273c;color:#fff;border:1px solid #32406b}
  .muted{color:#9aa4cf;font-size:13px;margin-top:14px}
</style>
</head>
<body>
  <main class="card">
    <h1>${htmlEscape(title)}</h1>
    ${lineHtml}
    <div class="actions">${buttonHtml}</div>
    <p class="muted">如果是從 Discord 進來，回到原本玩家面板再重新綁定即可。</p>
  </main>
</body>
</html>`;
  }

  function mapTwitchTierToPlayerTier(tier) {
    const normalized = String(tier || "").trim();
    const mapping = {
      "1000": "C",
      "2000": "C",
      "3000": "B"
    };
    return mapping[normalized] || null;
  }

  function mapYoutubeLevelToPlayerTier(displayName) {
    const normalized = String(displayName || "").trim();
    const mapping = config.streamMembership?.youtubeTiers || {};
    for (const [tier, name] of Object.entries(mapping)) {
      if (normalized === String(name || "").trim()) return tier;
    }
    return null;
  }

  function pickHigherTier(a, b) {
    const tierOrder = ["E", "D", "C", "B", "A", "S", "SS"];
    const normA = String(a || "").trim().toUpperCase();
    const normB = String(b || "").trim().toUpperCase();
    const idxA = tierOrder.indexOf(normA);
    const idxB = tierOrder.indexOf(normB);
    if (idxA === -1) return normB || normA || null;
    if (idxB === -1) return normA || normB || null;
    return idxA >= idxB ? normA : normB;
  }

  async function fetchGoogleCreatorAccessToken() {
    return serviceContext.creatorTokenService.getValidToken("youtube");
  }

  async function fetchTwitchBroadcasterAccessToken() {
    return serviceContext.creatorTokenService.getValidToken("twitch");
  }

  async function upsertStreamBindingAndTier({
    discordId,
    provider,
    platformUserId,
    displayName,
    tier,
    memberRoleIdsAtLink = [],
    linkedSupportAtLink = null,
    linkedSupportKindAtLink = null,
    linkedSupportBadgeLabelsAtLink = []
  }) {
    const bindingRepo = serviceContext.streamAccountBindingRepository;
    const existingSameProvider = await bindingRepo.findByDiscordAndPlatform(discordId, provider).catch(() => null);
    if (existingSameProvider && existingSameProvider.platformUserId && existingSameProvider.platformUserId !== platformUserId) {
      throw new Error(`你的 ${provider === "youtube" ? "YouTube" : "Twitch"} 已綁定過，無法更換帳號。`);
    }

    const existingByPlatform = await bindingRepo.findByPlatformAndUserId(provider, platformUserId).catch(() => null);
    if (existingByPlatform && existingByPlatform.discordId && existingByPlatform.discordId !== discordId) {
      throw new Error("該帳號已綁定其他DC");
    }

    const payload = {
      platform: provider,
      platformUserId,
      discordId,
      displayName,
      linkedAt: existingSameProvider?.linkedAt || new Date().toISOString(),
      playerTierAtLink: tier || existingSameProvider?.playerTierAtLink || null,
      memberRoleIdsAtLink,
      linkedSupportAtLink,
      linkedSupportKindAtLink,
      linkedSupportBadgeLabelsAtLink
    };
    await bindingRepo.save(payload);

    if (tier) {
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (progress && progress.playerTier !== tier) {
        progress.playerTier = tier;
        progress.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(progress);
      }
    }

    return payload;
  }

  async function sendTierDm(discordId, lines) {
    try {
      if (!discordClient?.isReady()) return false;
      const user = await discordClient.users.fetch(discordId).catch(() => null);
      if (!user) return false;
      await user.send(lines.join("\n"));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function getDiscordOAuthProfile(accessToken) {
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userData = await userRes.json();
    if (!userRes.ok || userData?.message || !userData?.id) {
      throw new Error(userData?.message || "Discord profile fetch failed");
    }
    return {
      id: String(userData.id),
      username: String(userData.username || "").trim(),
      globalName: String(userData.global_name || "").trim()
    };
  }

  async function buildBindingAudit(discordId) {
    const bindingRepo = serviceContext.streamAccountBindingRepository;
    const bindings = await bindingRepo.listByDiscordId(discordId).catch(() => []);
    const duplicates = [];
    for (const binding of bindings) {
      if (!binding?.platform || !binding?.platformUserId) continue;
      const found = await bindingRepo.findByPlatformAndUserId(binding.platform, binding.platformUserId).catch(() => null);
      if (found && String(found.discordId || "") !== String(discordId)) {
        duplicates.push({
          platform: binding.platform,
          platformUserId: binding.platformUserId,
          displayName: binding.displayName || found.displayName || "",
          otherDiscordId: found.discordId || "",
          linkedAt: found.linkedAt || null
        });
      }
    }
    return { bindings, duplicates };
  }

  async function getTwitchProfile(accessToken) {
    const auth = config.streamAuth || {};
    const validateRes = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const validateData = await validateRes.json();
    if (!validateRes.ok) {
      throw new Error(validateData?.message || "Twitch token validate failed");
    }
    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": auth.twitchClientId
      }
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData?.data?.length) {
      throw new Error(userData?.message || "無法取得 Twitch 使用者資料");
    }
    const user = userData.data[0];
    return {
      userId: validateData.user_id || user.id,
      login: validateData.login || user.login,
      displayName: user.display_name || validateData.login || user.login
    };
  }

  async function parseTwitchSubscriptionTier(userId) {
    const auth = config.streamAuth || {};
    if (!auth.twitchClientId || !auth.twitchBroadcasterId) {
      throw new Error("Twitch 會員驗證未設定完成，請先補齊 TWITCH_CLIENT_ID / TWITCH_BROADCASTER_ID。");
    }
    const broadcasterToken = await fetchTwitchBroadcasterAccessToken();
    const subRes = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${encodeURIComponent(auth.twitchBroadcasterId)}&user_id=${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${broadcasterToken}`,
        "Client-Id": auth.twitchClientId
      }
    });
    if (subRes.status === 404) return null;
    const subData = await subRes.json();
    if (!subRes.ok) {
      throw new Error(subData?.message || subRes.statusText || "Twitch 訂閱查詢失敗");
    }
    return subData?.data?.[0]?.tier || null;
  }

  async function getYoutubeProfile(accessToken) {
    const channelsRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const channelsData = await channelsRes.json();
    if (!channelsRes.ok || !channelsData?.items?.length) {
      throw new Error(channelsData?.error?.message || "無法取得 YouTube 頻道資料");
    }
    const channel = channelsData.items[0];
    return {
      channelId: channel.id,
      displayName: channel.snippet?.title || channel.id
    };
  }

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
    const keys = ALL_ZONE_KEYS;
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

  router.get("/api/stream-auth/start", async (req, res) => {
    try {
      const provider = String(req.query.provider || "").trim().toLowerCase();
      const stateToken = String(req.query.state || "").trim();
      if (!provider || !["youtube", "twitch"].includes(provider)) {
        return res.status(400).send(renderAuthResultPage("授權失敗", ["❌ 缺少或錯誤的 provider。"]));
      }
      const state = verifyStreamAuthState(stateToken);
      const baseUrl = getPublicBaseUrl(req);
      const callbackUrl = `${baseUrl}/api/stream-auth/callback/${provider}`;

      if (provider === "twitch") {
        const auth = config.streamAuth || {};
        if (!auth.twitchClientId || !auth.twitchClientSecret || !auth.twitchBroadcasterId) {
          return res.status(500).send(renderAuthResultPage("授權失敗", [
            "❌ Twitch OAuth 尚未設定完成。",
            "請補齊 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET / TWITCH_BROADCASTER_ID。"
          ]));
        }
        const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
        authorizeUrl.search = new URLSearchParams({
          client_id: auth.twitchClientId,
          redirect_uri: callbackUrl,
          response_type: "code",
          // bind 階段只證明身分，訂閱狀態由 broadcaster token 查詢
          scope: "",
          state: stateToken
        }).toString();
        return res.redirect(authorizeUrl.toString());
      }

      const auth = config.streamAuth || {};
      if (!auth.youtubeClientId || !auth.youtubeClientSecret) {
        return res.status(500).send(renderAuthResultPage("授權失敗", [
          "❌ YouTube OAuth 尚未設定完成。",
          "請補齊 YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET。"
        ]));
      }
      // 註：broadcaster refresh token 在 creatorTokens collection（由 /admin/creator-auth 流程寫入），
      //     玩家綁定流程本身只需要 client_id/secret + 用戶 OAuth code，不需要 creator token

      const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizeUrl.search = new URLSearchParams({
        client_id: auth.youtubeClientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/youtube.readonly"
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
        state: stateToken
      }).toString();
      return res.redirect(authorizeUrl.toString());
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("授權失敗", [
        `❌ ${err.message || "授權流程無法啟動"}`
      ]));
    }
  });

  router.get("/api/discord-auth/start", async (req, res) => {
    try {
      const discordId = String(req.query.discordId || "").trim();
      const discordName = String(req.query.discordName || "").trim();
      if (!discordId) {
        return res.status(400).send(renderAuthResultPage("授權失敗", ["❌ 缺少 Discord ID。"]));
      }
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).send(renderAuthResultPage("授權失敗", [
          "❌ Discord OAuth 尚未設定完成。",
          "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
        ]));
      }
      const stateToken = signDiscordAuthState({ discordId, discordName });
      const callbackUrl = `${getPublicBaseUrl(req)}/api/discord-auth/callback`;
      const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
      authorizeUrl.search = new URLSearchParams({
        client_id: auth.clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: "identify",
        state: stateToken,
        prompt: "consent"
      }).toString();
      return res.redirect(authorizeUrl.toString());
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("授權失敗", [
        `❌ ${err.message || "Discord 授權流程無法啟動"}`
      ]));
    }
  });

  router.get("/api/discord-auth/callback", async (req, res) => {
    try {
      const state = verifyDiscordAuthState(req.query.state);
      if (!state || state.purpose !== "discord-binding-audit") {
        throw new Error("授權狀態無效，請重新從玩家面板開啟。");
      }
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send(renderAuthResultPage("Discord 授權失敗", ["❌ 缺少授權 code。"]));
      }
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).send(renderAuthResultPage("Discord 授權失敗", [
          "❌ Discord OAuth 尚未設定完成。",
          "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
        ]));
      }

      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${getPublicBaseUrl(req)}/api/discord-auth/callback`
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData?.error_description || tokenData?.error || "Discord token exchange failed");
      }

      const profile = await getDiscordOAuthProfile(tokenData.access_token);
      if (state.discordId && String(state.discordId) !== String(profile.id)) {
        throw new Error("你登入的 Discord 與按鈕發送者不一致，請使用原本那個帳號重新驗證。");
      }

      const guildId = config.discord?.guildId;
      if (guildId && discordClient) {
        const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
        if (guild) {
          const member = await guild.members.fetch({ user: profile.id, force: true }).catch(() => null);
          if (!member) {
            return res.status(403).send(renderAuthResultPage("Discord 授權失敗", [
              "❌ 你必須先加入伺服器才能進行驗證。"
            ]));
          }
        }
      }

      const audit = await buildBindingAudit(profile.id);
      const lines = [
        "✅ Discord 授權完成",
        `帳號：${profile.globalName || profile.username || "Unknown"} (${profile.id})`,
        audit.bindings.length > 0
          ? `目前綁定：${audit.bindings.map((b) => `${b.platform === "youtube" ? "YouTube" : "Twitch"}:${b.displayName || b.platformUserId}`).join("、")}`
          : "目前沒有任何直播綁定",
        audit.duplicates.length > 0
          ? `重複綁定：${audit.duplicates.map((d) => `${d.platform === "youtube" ? "YouTube" : "Twitch"}:${d.displayName || d.platformUserId} → ${d.otherDiscordId}`).join("、")}`
          : "未發現與其他 DC 重複的綁定"
      ];

      await sendTierDm(profile.id, lines);

      return res.send(renderAuthResultPage("Discord 驗證完成", lines, [
        { label: "回到 Discord", href: config.discord.inviteUrl || "https://discord.gg/", kind: "secondary" }
      ]));
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("Discord 授權失敗", [
        `❌ ${err.message || "Discord 授權失敗"}`
      ]));
    }
  });

  router.get("/api/stream-auth/callback/twitch", async (req, res) => {
    try {
      const state = verifyStreamAuthState(req.query.state);
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send(renderAuthResultPage("Twitch 授權失敗", ["❌ 缺少授權 code。"]));
      }

      const auth = config.streamAuth || {};
      const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.twitchClientId,
          client_secret: auth.twitchClientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${getPublicBaseUrl(req)}/api/stream-auth/callback/twitch`
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData?.message || tokenData?.error_description || "Twitch token exchange failed");
      }

      const profile = await getTwitchProfile(tokenData.access_token);
      const tierRaw = await parseTwitchSubscriptionTier(profile.userId).catch((err) => {
        console.warn("[stream-auth/twitch] subscription check via broadcaster token failed:", err.message);
        return null;
      });
        const mappedTier = mapTwitchTierToPlayerTier(tierRaw);
        const progress = await serviceContext.progressRepository.findByPlayerId(state.discordId);
        const currentTier = progress?.playerTier || null;
        const newTier = pickHigherTier(mappedTier, currentTier) || currentTier || mappedTier || null;
      const linkedSupportBadgeLabelsAtLink = tierRaw ? [`訂閱等級:${tierRaw}`] : [];

      const binding = await upsertStreamBindingAndTier({
        discordId: state.discordId,
        provider: "twitch",
        platformUserId: profile.userId,
        displayName: profile.displayName,
        tier: newTier,
        memberRoleIdsAtLink: [],
        linkedSupportAtLink: Boolean(tierRaw),
        linkedSupportKindAtLink: tierRaw ? "subscriber" : null,
        linkedSupportBadgeLabelsAtLink
      });

      const lines = [
        "✅ Twitch 授權完成",
        `帳號：${profile.displayName} (${profile.userId})`,
        tierRaw ? `訂閱等級：${tierRaw}` : "目前沒有偵測到訂閱，位階維持原狀",
        newTier ? `已同步位階：${newTier}` : `位階維持原狀：${currentTier || "未設定"}`
      ];

      await sendTierDm(state.discordId, lines);

      return res.send(renderAuthResultPage("Twitch 授權完成", lines, [
        { label: "回到 Discord", href: config.discord.inviteUrl || "https://discord.gg/", kind: "secondary" }
      ]));
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("Twitch 授權失敗", [
        `❌ ${err.message || "Twitch 授權失敗"}`
      ]));
    }
  });

  router.get("/api/stream-auth/callback/youtube", async (req, res) => {
    try {
      const state = verifyStreamAuthState(req.query.state);
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send(renderAuthResultPage("YouTube 授權失敗", ["❌ 缺少授權 code。"]));
      }

      const auth = config.streamAuth || {};
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: auth.youtubeClientId,
          client_secret: auth.youtubeClientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${getPublicBaseUrl(req)}/api/stream-auth/callback/youtube`
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData?.error_description || tokenData?.error || "YouTube token exchange failed");
      }

      const profile = await getYoutubeProfile(tokenData.access_token);

      // 查會員狀態時容錯：頻道沒開 Channel Memberships、broadcaster token 過期、quota 用完
      // 等等情況都不該擋 bind，bind 是「身分綁定」，會員狀態查不到當未訂閱處理。
      let levelName = null;
      let memberLookupError = null;
      try {
        const creatorAccessToken = await fetchGoogleCreatorAccessToken();
        const memberRes = await fetch(`https://www.googleapis.com/youtube/v3/members?part=snippet&filterByMemberChannelId=${encodeURIComponent(profile.channelId)}&maxResults=1`, {
          headers: { Authorization: `Bearer ${creatorAccessToken}` }
        });
        const memberData = await memberRes.json().catch(() => ({}));
        if (!memberRes.ok) {
          memberLookupError = memberData?.error?.message || memberData?.error?.errors?.[0]?.message || `${memberRes.status} ${memberRes.statusText}`;
          console.warn("[stream-auth/youtube] member 查詢失敗（不擋 bind）:", memberLookupError);
        } else {
          const member = memberData?.items?.[0] || null;
          levelName = member?.snippet?.membershipsDetails?.highestAccessibleLevelDisplayName || null;
        }
      } catch (err) {
        memberLookupError = err.message || String(err);
        console.warn("[stream-auth/youtube] member 查詢例外（不擋 bind）:", memberLookupError);
      }
        const mappedTier = mapYoutubeLevelToPlayerTier(levelName);
        const progress = await serviceContext.progressRepository.findByPlayerId(state.discordId);
        const currentTier = progress?.playerTier || null;
        const newTier = pickHigherTier(mappedTier, currentTier) || currentTier || mappedTier || null;
      const linkedSupportBadgeLabelsAtLink = levelName ? [`會員等級:${levelName}`] : [];

      const binding = await upsertStreamBindingAndTier({
        discordId: state.discordId,
        provider: "youtube",
        platformUserId: profile.channelId,
        displayName: profile.displayName,
        tier: newTier,
        memberRoleIdsAtLink: [],
        linkedSupportAtLink: Boolean(levelName),
        linkedSupportKindAtLink: levelName ? "member" : null,
        linkedSupportBadgeLabelsAtLink
      });

      const lines = [
        "✅ YouTube 授權完成",
        `頻道：${profile.displayName} (${profile.channelId})`,
        levelName ? `會員等級：${levelName}` : (memberLookupError
          ? `會員狀態暫時無法查詢（${memberLookupError}）`
          : "目前沒有偵測到會員，位階維持原狀"),
        newTier ? `已同步位階：${newTier}` : `位階維持原狀：${currentTier || "未設定"}`
      ];

      await sendTierDm(state.discordId, lines);

      return res.send(renderAuthResultPage("YouTube 授權完成", lines, [
        { label: "回到 Discord", href: config.discord.inviteUrl || "https://discord.gg/", kind: "secondary" }
      ]));
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("YouTube 授權失敗", [
        `❌ ${err.message || "YouTube 授權失敗"}`
      ]));
    }
  });

  // 1. OAuth2 Login
  // 網頁 Discord 登入：導向 Discord OAuth（callback 回 game.html，前端再拿 code 換 JWT）
  router.get("/api/auth/discord/login", (req, res) => {
    try {
      const auth = config.discord || {};
      if (!auth.clientId || !auth.clientSecret) {
        return res.status(500).send(renderAuthResultPage("登入失敗", [
          "❌ Discord 登入尚未設定完成。",
          "請補齊 DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET。"
        ]));
      }
      const returnTo = String(req.query.returnTo || "/game.html");
      const redirectUri = `${getPublicBaseUrl(req)}${returnTo}`;
      const url = new URL("https://discord.com/api/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: auth.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify",
        prompt: "consent"
      }).toString();
      return res.redirect(url.toString());
    } catch (err) {
      return res.status(400).send(renderAuthResultPage("登入失敗", [`❌ ${err.message || "無法啟動 Discord 登入"}`]));
    }
  });

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
        // 從 Discord 抓真實名稱（公會暱稱優先，其次帳號名），避免一律記成 "WebPlayer"
        if (discordClient) {
          try {
            const guildId = require("../../config").discord?.guildId;
            if (guildId) {
              const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
              const member = guild ? await guild.members.fetch({ user: discordId, force: false }).catch(() => null) : null;
              if (member?.displayName) displayName = member.displayName;
            }
            if (displayName === "WebPlayer") {
              const u = await discordClient.users.fetch(discordId).catch(() => null);
              if (u) displayName = u.globalName || u.username || displayName;
            }
          } catch (_) {}
        }
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

      // 計算完整戰鬥能力（與 DC「我的資料」一致）
      let combatStats = null;
      let equipBonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
      let mergedEquipment = progress?.equipment || {};
      try {
        const { calcPlayerStats } = require("../../shared/combatStats");
        mergedEquipment = await mergeEquippedFromLibrary(progress?.equipment || {}, serviceContext.itemRepository);
        const cs = calcPlayerStats(attrs, mergedEquipment, progress?.activeEffects || [], progress?.inventory || []);
        // 計算裝備屬性加成
        for (const item of Object.values(mergedEquipment)) {
          if (!item?.equipStats) continue;
          for (const [k, v] of Object.entries(item.equipStats)) {
            if (k in equipBonus) equipBonus[k] += (Number(v) || 0);
          }
        }
        combatStats = {
          maxHp: Math.ceil(cs.maxHp),
          atk: Math.ceil(cs.atk),
          def: Math.ceil(cs.def),
          hit: Math.ceil(cs.hit || 0),
          dodge: Math.ceil(cs.dodge || 0),
          block: Math.ceil(cs.blockChance || 0),
          crit: Math.ceil(cs.crit || 0),
          combo: Math.ceil(cs.combo || 0),
          weaponType: cs.weaponType || null,
          isTwoHanded: Boolean(cs.isTwoHanded),
          isDualWield: Boolean(cs.isDualWield),
          tierSetBonuses: cs.tierSetBonuses || null
        };
      } catch (err) {
        console.warn("[profile] combatStats calc failed:", err?.message || err);
      }

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
          equipBonus,
          equipment: mergedEquipment,
          combatStats,
          activeEffects: progress?.activeEffects || [],
          jobSpecialDisplay: buildJobSpecialDisplay(progress)
        }
      }));
    } catch (err) {
      next(err);
    }
  });

  // 2.4 Issue stream-auth state token — 前端綁定流程的第一步
  router.post("/api/me/stream-auth/state", requireAuth, (req, res) => {
    const { discordId } = req.playerRecord;
    const state = signStreamAuthState(discordId);
    res.json(ok({ state, expiresIn: STREAM_AUTH_STATE_TTL }));
  });

  // 2.5 Fetch Stream Bindings + 即時會員狀態（用 broadcaster token 查）
  router.get("/api/me/bindings", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const bindings = await serviceContext.streamAccountBindingRepository
        .listByDiscordId(discordId)
        .catch(() => []);

      // 對每個 binding 嘗試即時查會員狀態
      const enriched = await Promise.all(bindings.map(async (b) => {
        const baseInfo = {
          platform: b.platform,
          platformUserId: b.platformUserId,
          displayName: b.displayName,
          linkedAt: b.linkedAt,
          playerTierAtLink: b.playerTierAtLink || null
        };
        try {
          if (b.platform === "twitch") {
            const tier = await parseTwitchSubscriptionTier(b.platformUserId);
            return {
              ...baseInfo,
              membership: {
                isMember: Boolean(tier),
                tier: tier || null,
                levelName: tier ? `訂閱等級 ${tier}` : null,
                checkedAt: new Date().toISOString(),
                source: "twitch-api"
              }
            };
          }
          if (b.platform === "youtube") {
            // 用 broadcaster token 查單一頻道是否是會員
            try {
              const creatorAccessToken = await fetchGoogleCreatorAccessToken();
              const memberRes = await fetch(
                `https://www.googleapis.com/youtube/v3/members?part=snippet&filterByMemberChannelId=${encodeURIComponent(b.platformUserId)}&maxResults=1`,
                { headers: { Authorization: `Bearer ${creatorAccessToken}` } }
              );
              const memberData = await memberRes.json().catch(() => ({}));
              if (!memberRes.ok) {
                throw new Error(memberData?.error?.message || "YouTube 會員查詢失敗");
              }
              const member = memberData?.items?.[0] || null;
              const levelName = member?.snippet?.membershipsDetails?.highestAccessibleLevelDisplayName || null;
              return {
                ...baseInfo,
                membership: {
                  isMember: Boolean(levelName),
                  tier: null,
                  levelName,
                  checkedAt: new Date().toISOString(),
                  source: "youtube-api"
                }
              };
            } catch (err) {
              return {
                ...baseInfo,
                membership: {
                  isMember: false,
                  checkedAt: new Date().toISOString(),
                  source: "unavailable",
                  error: err.message
                }
              };
            }
          }
          return baseInfo;
        } catch (err) {
          return {
            ...baseInfo,
            membership: {
              isMember: false,
              checkedAt: new Date().toISOString(),
              source: "unavailable",
              error: err.message
            }
          };
        }
      }));

      res.json(ok({ bindings: enriched }));
    } catch (err) {
      next(err);
    }
  });

  // 2.6 SSE realtime — server push 推送資料變化給 web client
  router.get("/api/me/stream", (req, res) => {
    // SSE 不能用 Authorization header（EventSource 不支援），改用 query param token
    const token = String(req.query.token || "").trim();
    let playerRecord;
    try {
      playerRecord = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
    } catch (_) {
      return res.status(401).json({ status: "error", message: "Invalid or expired token" });
    }
    const discordId = String(playerRecord?.discordId || "").trim();
    if (!discordId) return res.status(400).json({ status: "error", message: "Missing discordId" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 給 nginx / cloudflare 用
    res.flushHeaders?.();

    const send = (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (_) { /* connection closed */ }
    };

    // 連線建立後送一個 hello 事件
    send({ type: "connected", data: { discordId, ts: new Date().toISOString() } });

    // 訂閱該玩家的 bus
    const { playerEventBus } = require("../../services/realtime/playerEventBus");
    const unsubscribe = playerEventBus.subscribe(discordId, send);

    // 每 25 秒送一個 heartbeat（避免被 proxy 斷線）
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch (_) {}
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
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
      const confirm = req.body?.confirm === true || req.body?.confirm === "true";
      if (!confirm) {
        const quote = await serviceContext.shopService.getSellQuote(discordId, uuid, 1);
        return res.json(ok({
          requiresConfirmation: true,
          confirmField: "confirm",
          itemName: quote.itemName,
          sellCount: quote.sellCount,
          priceEach: quote.priceEach,
          totalGold: quote.totalGold,
          message: `你確定要販售 ${quote.itemName} 嗎？販售總價值 ${quote.totalGold} 金幣。`
        }));
      }
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
      const keys = ALL_ZONE_KEYS;
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
      const keys = ALL_ZONE_KEYS;
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
      const zoneKey = normalizeZone(req.body.zone);

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

      // Check level — 優先讀 channel layout binding 的自訂限制，fallback 到靜態預設
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const playerLevel = progress?.level ?? 1;
      const layout = await serviceContext.adminConsoleService.getChannelLayout();
      const featureKey = zoneToFeatureKey(zoneKey);
      const zoneBinding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey && b.enabled);
      const levelError = checkZoneLevelRequirementWithBinding(zoneKey, playerLevel, zoneBinding || null);
      if (levelError) {
        return res.status(400).json({ status: "error", message: levelError });
      }

      // Calc player stats（永遠從 DB 讀取最新 effects，不使用 snapshot 裡的舊值）
      const { calcPlayerStats } = require("../../shared/combatStats");
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, serviceContext.itemRepository);
      const pStats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], progress?.inventory || []);

      // ── 共鬥光環系統 ──
      const freshStateForAura = await serviceContext.monsterService.getState(zoneKey);

      let stateForCombat = freshStateForAura;
      let partyEffects = [];
      const rawPartyEffs = collectEquipmentEffects(equipped, "passive", { equipped, inventory: progress?.inventory || [] })
        .filter(e => e.target === "party");
      const partyEffs = scaleSupportPartyEffects(rawPartyEffs, { providerStats: pStats, equipped });
      const hasPartyAura = partyEffs.length > 0;

      if (hasPartyAura) {
        // 光環職業進入：收集 party 效果並記錄光環
        const auraState = {
          ...freshStateForAura,
          activeHealerAura: {
            discordId,
            displayName,
            effects: rawPartyEffs
          }
        };
        await serviceContext.monsterService.saveState(auraState, zoneKey);
        stateForCombat = auraState;
        partyEffects = partyEffs;
      } else if (freshStateForAura.activeHealerAura?.discordId === discordId) {
        // 同一玩家不再具備 party 光環 → 清除光環
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
        let auraProviderStats = null;
        let auraProviderEquipped = {};
        if (aura?.discordId) {
          const auraProgress = await serviceContext.progressRepository.findByPlayerId(aura.discordId).catch(() => null);
          if (auraProgress) {
            auraProviderEquipped = await mergeEquippedFromLibrary(auraProgress.equipment || {}, serviceContext.itemRepository);
            const auraAttrs = auraProgress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
            auraProviderStats = calcPlayerStats(auraAttrs, auraProviderEquipped, auraProgress.activeEffects || [], auraProgress.inventory || []);
          }
        }
        partyEffects = scaleSupportPartyEffects(
          (aura?.effects || []).map(e => ({ ...e, sourceName: aura?.displayName || null })),
          { providerStats: auraProviderStats || {}, equipped: auraProviderEquipped }
        );
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
      const combatResult =
        runCombatLoop(pStats, monster.calc, monster.name, monsterHpInitial, undefined, {
          playerName: displayName,
          playerLevel: progress?.level || 1,
          equipped,
          inventory: progress?.inventory || [],
          partyEffects,
          monsterEquipped,
          monsterIsBoss: Boolean(monster?.isBoss)
        });
      const { roundLogs, finalPlayerHp, combatStats } = combatResult;
      const zoneDamageSyncApplied = ["beginner", "normal"].includes(zoneKey) && !isOnlyDTierEquipped(equipped);
      const syncResult = zoneDamageSyncApplied
        ? applyZoneDamageSync(
          zoneKey,
          monsterHpInitial,
          monster.calc?.maxHp,
          combatResult.totalDamage,
          combatResult.finalMonsterHp,
          combatResult.outcome
        )
        : {
          damage: Math.max(0, Math.round(Number(combatResult.totalDamage || 0))),
          monsterHp: Math.max(0, Math.round(Number(combatResult.finalMonsterHp ?? Math.max(0, monsterHpInitial - combatResult.totalDamage)))),
          outcome: combatResult.outcome,
          applied: false,
          notice: null
        };
      const outcome = syncResult.outcome;
      const totalDamage = syncResult.damage;
      const totalTaken = Math.max(0, (pStats.maxHp || 0) - Math.max(0, finalPlayerHp));

      // 蝯?
      const { handleMonsterKill, _republishPanel, _republishPanelWithRankingDebounce, MAX_ROUNDS } = require("../../bot/handlers/monsterZoneHandlers");
      let rewardLines = [];
      let mHp = syncResult.monsterHp;
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
        const sessionPayload = { monsterName: monster.name, entryFee: monster.entryFee ?? getZoneDefaultEntryFee(zoneKey) };
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
          rewardLines = [`You were defeated by **${monster.name}**!`, (monster.entryFee ?? getZoneDefaultEntryFee(zoneKey)) > 0 ? "Entry fee consumed." : "Try again next time."];
        } else {
          rewardLines = [`Survived ${MAX_ROUNDS} rounds and forced the monster to retreat.`];
        }
        rewardLines.push("Monster battle state has been updated in the zone panel.");

        // update panel（排行榜去重，最多 5 秒更新一次）
        _republishPanelWithRankingDebounce(serviceContext, zoneKey, monster, mHp, currentParticipants.length + 1, damageMap).catch(() => {});
      }

      if (syncResult.notice) {
        rewardLines = [syncResult.notice, ...rewardLines];
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
        const questService = serviceContext.questService || serviceContext.weeklyQuestService;
        await questService.recordProgress(discordId, "battle_count", 1);
        // battle_win is granted in handleMonsterKill to all participants on kill.
        await questService.recordProgress(discordId, "damage_total", totalDamage);
        if (outcome === "lose") {
          await questService.recordProgress(discordId, "death_count", 1);
        }
        if (combatStats) {
          if (combatStats.comboCount > 0) await questService.recordProgress(discordId, "combo_count", combatStats.comboCount);
          if (combatStats.dodgeCount > 0) await questService.recordProgress(discordId, "dodge_count", combatStats.dodgeCount);
          if (combatStats.blockCount > 0) await questService.recordProgress(discordId, "block_count", combatStats.blockCount);
          if (combatStats.stunCount > 0) await questService.recordProgress(discordId, "stun_count", combatStats.stunCount);
          if (combatStats.burnTriggerCount > 0) await questService.recordProgress(discordId, "burn_trigger_count", combatStats.burnTriggerCount);
        }
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
  // 世界王（player 端唯讀狀態）
  // ──────────────────────────────────────────────────
  router.get("/api/worldboss/status", requireAuth, async (req, res, next) => {
    try {
      const wb = serviceContext.worldBossService;
      if (!wb) {
        return res.json(ok({ enabled: false, config: null, state: null, status: null }));
      }
      const data = await wb.getConfigWithStatus();
      res.json(ok({
        enabled: data.config?.enabled !== false,
        config: {
          bossName: data.config?.bossName || "世界王",
          bossMaxHp: data.config?.bossMaxHp || 0,
          respawnCooldownMinutes: data.config?.respawnCooldownMinutes || 0,
          battleTimeLimitMinutes: data.config?.battleTimeLimitMinutes || 60,
          imageUrl: data.config?.imageUrl || null,
          rewards: data.config?.rewards || null,
          enabled: data.config?.enabled !== false
        },
        state: {
          weekKey: data.state?.weekKey || null,
          currentHp: data.state?.currentHp ?? data.config?.bossMaxHp ?? 0,
          hardKills: data.state?.hardKills || 0,
          lastKilledAt: data.state?.lastKilledAt || null,
          battleStartedAt: data.state?.battleStartedAt || null
        },
        status: data.status
      }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 賭場 / 命運轉盤（玩家端；DC 賭場面板對應）
  // ──────────────────────────────────────────────────
  router.get("/api/casino/state", requireAuth, async (req, res, next) => {
    try {
      const cs = serviceContext.casinoService;
      if (!cs) return res.json(ok({ enabled: false, round: null, recent: [], myBets: [] }));
      const { discordId } = req.playerRecord;
      const [round, recent] = await Promise.all([cs.getCurrentRound(), cs.getRecentRounds(12)]);
      const myBets = round ? await cs.getPlayerBetsInRound(round.roundId, discordId) : [];
      const { COLOR_META, BET_MIN, BET_MAX } = require("../../services/casino/wheelConfig");
      res.json(ok({ enabled: true, round, recent, myBets, colors: COLOR_META, betMin: BET_MIN, betMax: BET_MAX, now: Date.now() }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/casino/bet", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { color, amount } = req.body || {};
      const result = await serviceContext.casinoService.placeBet({ discordId, displayName, color, amount });
      res.json(ok(result, "下注成功"));
    } catch (err) {
      if (err?.message) return res.status(400).json(fail("BET_FAILED", err.message));
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 寵物採集（玩家端；DC 寵物面板對應）
  // ──────────────────────────────────────────────────
  function petSvc(res) {
    const s = serviceContext.petService;
    if (!s) { res.json(ok({ pets: [], active: null, activePetUuid: null })); return null; }
    return s;
  }
  router.get("/api/me/pets", requireAuth, async (req, res, next) => {
    try { const s = petSvc(res); if (!s) return; res.json(ok(await s.getPetState(req.playerRecord.discordId))); }
    catch (err) { next(err); }
  });
  router.post("/api/me/pets/feed", requireAuth, async (req, res, next) => {
    try {
      const { petUuid, inventoryUuid, tier } = req.body || {};
      const r = await serviceContext.petService.feedPet(req.playerRecord.discordId, petUuid, { inventoryUuid, tier });
      res.json(ok(r, r?.message || "餵食完成"));
    } catch (err) { if (err?.message) return res.status(400).json(fail("PET_FEED_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/claim", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.claimGathering(req.playerRecord.discordId); res.json(ok(r, r?.message || "已收取採集物")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_CLAIM_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/active", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.setActivePet(req.playerRecord.discordId, req.body?.petUuid); res.json(ok(r, "已設為出戰寵物")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_ACTIVE_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/release", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.releasePet(req.playerRecord.discordId, req.body?.petUuid); res.json(ok(r, "已放生")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_RELEASE_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/rename", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.renamePet(req.playerRecord.discordId, req.body?.petUuid, req.body?.nickname); res.json(ok(r, "已改名")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_RENAME_FAILED", err.message)); next(err); }
  });
  router.post("/api/me/pets/hatch", requireAuth, async (req, res, next) => {
    try { const r = await serviceContext.petService.hatchEggFromInventory(req.playerRecord.discordId, req.body?.inventoryUuid); res.json(ok(r, r?.message || "已放入孵化")); }
    catch (err) { if (err?.message) return res.status(400).json(fail("PET_HATCH_FAILED", err.message)); next(err); }
  });

  // ──────────────────────────────────────────────────
  // 爬塔（單人，網頁版；逐層挑戰、HP 帶入、繼續/撤退）
  // 數值完全比照 src/shared/towerConfig.js（與 DC 組隊爬塔同源）
  // ──────────────────────────────────────────────────
  const towerSessions = new Map(); // discordId -> { floor, playerHp, playerMaxHp, baseAtk, equipped, used:Set, alive, settled, startedAt }
  const TW = require("../../shared/towerConfig");

  async function pickTowerMonster(floor, usedNames) {
    // 固定王關：直接取指定 boss（龍王(B)@50／大史王@51／古龍王(B)@52 等），與 DC 組隊爬塔同源
    const bossName = TW.getTowerFloorBossName(floor);
    if (bossName) {
      const all = await serviceContext.monsterService.listMonsters({ includeDisabled: false }).catch(() => []);
      const boss = all.find((m) => m.name === bossName);
      if (boss) return boss;
    }
    const pool = TW.getTowerMonsterPool(floor); // { zone, bossOnly }
    let mons = await serviceContext.monsterService.listMonsters({ includeDisabled: false, zone: pool.zone }).catch(() => []);
    if (pool.bossOnly) mons = mons.filter((m) => m.isBoss);
    else mons = mons.filter((m) => m.name !== "廢都魔王(B)");
    if (!mons.length) return null;
    const fresh = mons.filter((m) => !usedNames.has(m.name));
    const arr = fresh.length ? fresh : mons;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async function settleTower(discordId, displayName, s) {
    if (s.settled) return s._reward || null;
    s.settled = true;
    const cleared = Math.max(0, s.floor - 1);
    const reward = TW.calcTowerReward(cleared);
    if (reward.gold > 0) await serviceContext.rewardService.grantCurrency({ discordId, displayName, currencyType: "gold", amount: reward.gold, source: "tower_web" }).catch(() => {});
    if (reward.exp > 0 && serviceContext.progressService?.grantExp) await serviceContext.progressService.grantExp({ discordId, displayName, amount: reward.exp, source: "tower_web" }).catch(() => {});
    try {
      const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (prog) {
        const rec = prog.towerRecord || { bestFloor: 0, totalRuns: 0 };
        rec.totalRuns = (rec.totalRuns || 0) + 1;
        if (cleared > (rec.bestFloor || 0)) { rec.bestFloor = cleared; rec.bestAt = new Date().toISOString(); }
        prog.towerRecord = rec; prog.updatedAt = new Date().toISOString();
        await serviceContext.progressRepository.save(prog).catch(() => {});
      }
    } catch (_) {}
    s._reward = { ...reward, clearedFloor: cleared };
    return s._reward;
  }

  router.get("/api/tower/state", requireAuth, async (req, res, next) => {
    try {
      const s = towerSessions.get(req.playerRecord.discordId);
      const prog = await serviceContext.progressRepository.findByPlayerId(req.playerRecord.discordId);
      res.json(ok({
        minLevel: TW.TOWER_MIN_LEVEL, totalFloors: TW.TOWER_TOTAL_FLOORS,
        level: prog?.level || 1, bestFloor: prog?.towerRecord?.bestFloor || 0,
        session: s && s.alive ? { floor: s.floor, playerHp: s.playerHp, playerMaxHp: s.playerMaxHp } : null,
      }));
    } catch (err) { next(err); }
  });

  router.post("/api/tower/start", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const prog = await serviceContext.progressRepository.findByPlayerId(discordId);
      const level = prog?.level || 1;
      if (level < TW.TOWER_MIN_LEVEL) return res.status(400).json(fail("LEVEL_TOO_LOW", `爬塔需要 Lv.${TW.TOWER_MIN_LEVEL} 以上（目前 Lv.${level}）`));
      const { calcPlayerStats } = require("../../shared/combatStats");
      const attrs = prog?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = await mergeEquippedFromLibrary(prog?.equipment || {}, serviceContext.itemRepository);
      const ps = calcPlayerStats(attrs, equipped, prog?.activeEffects || [], prog?.inventory || []);
      const bonus = TW.getCumulativePartyBonus(1);
      const maxHp = Math.round((ps.maxHp || 100) * (1 + bonus.hpPct / 100));
      const s = { floor: 1, playerHp: maxHp, playerMaxHp: maxHp, baseAtk: ps.atk || 1, baseStats: ps, equipped, inventory: prog?.inventory || [], used: new Set(), alive: true, settled: false, startedAt: Date.now() };
      towerSessions.set(discordId, s);
      res.json(ok({ floor: s.floor, playerHp: s.playerHp, playerMaxHp: s.playerMaxHp, totalFloors: TW.TOWER_TOTAL_FLOORS }));
    } catch (err) { next(err); }
  });

  router.post("/api/tower/fight", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const s = towerSessions.get(discordId);
      if (!s || !s.alive) return res.status(400).json(fail("NO_SESSION", "沒有進行中的爬塔，請先開始"));
      const floor = s.floor;
      const monster = await pickTowerMonster(floor, s.used);
      if (!monster) return res.status(400).json(fail("NO_MONSTER", "找不到該層怪物"));
      s.used.add(monster.name);

      const baseHp = monster.calc?.maxHp || monster.maxHp || 200;
      const baseAtk = monster.calc?.atk || 20;
      const scaledHp = TW.scaleTowerMonsterHp(baseHp, floor);
      const scaledAtk = TW.scaleTowerMonsterAtk(baseAtk, floor);
      const bonus = TW.getCumulativePartyBonus(floor);
      const ps = { ...s.baseStats, maxHp: s.playerMaxHp, atk: Math.round(s.baseAtk * (1 + bonus.atkPct / 100)) };
      const mCalc = { ...(monster.calc || {}), maxHp: scaledHp, atk: scaledAtk, isBoss: Boolean(monster.isBoss) };

      const { runCombatLoop } = require("../../shared/combatLoop");
      const r = runCombatLoop(ps, mCalc, monster.name, scaledHp, TW.MAX_ROUNDS_PER_MEMBER, {
        playerName: displayName, playerLevel: (await serviceContext.progressRepository.findByPlayerId(discordId))?.level || 1,
        equipped: s.equipped, inventory: s.inventory, monsterIsBoss: Boolean(monster.isBoss),
        startPlayerHp: s.playerHp,
      });
      s.playerHp = Math.max(0, r.finalPlayerHp);
      const killed = (r.finalMonsterHp ?? 0) <= 0 && r.outcome === "win";
      const died = s.playerHp <= 0;

      let towerOver = false, reward = null, cleared = false;
      if (killed) {
        cleared = true; s.floor = floor + 1;
        if (s.floor > TW.TOWER_TOTAL_FLOORS) { towerOver = true; reward = await settleTower(discordId, displayName, s); s.alive = false; }
      } else {
        // 未擊殺（陣亡或回合耗盡）→ 本次攻塔結束，結算
        towerOver = true; s.alive = false; reward = await settleTower(discordId, displayName, s);
      }

      res.json(ok({
        floor, cleared, towerOver, died,
        monsterName: monster.name, monsterImageUrl: monster.imageUrl || null,
        enemyMaxHp: scaledHp, logs: r.roundLogs, outcome: r.outcome,
        finalPlayerHp: s.playerHp, finalMonsterHp: Math.max(0, r.finalMonsterHp ?? 0),
        nextFloor: s.alive ? s.floor : null, playerMaxHp: s.playerMaxHp, reward,
      }));
    } catch (err) { next(err); }
  });

  router.post("/api/tower/retreat", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const s = towerSessions.get(discordId);
      if (!s || !s.alive) return res.status(400).json(fail("NO_SESSION", "沒有進行中的爬塔"));
      const reward = await settleTower(discordId, displayName, s);
      s.alive = false;
      res.json(ok({ retreated: true, reward }));
    } catch (err) { next(err); }
  });

  // ──────────────────────────────────────────────────
  // PK 擂台（網頁端；與 Discord 共用同一擂台狀態）
  // ──────────────────────────────────────────────────
  const pkArena = require("../../bot/handlers/pkArenaHandlers");
  router.get("/api/pk/state", requireAuth, async (req, res, next) => {
    try { res.json(ok(await pkArena.webGetArenaState(req.playerRecord.discordId))); }
    catch (err) { next(err); }
  });
  router.post("/api/pk/join", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const r = await pkArena.webJoinQueue(discordId, displayName);
      if (!r.ok) return res.status(400).json(fail("PK_JOIN_FAILED", r.message));
      res.json(ok(r, r.matched ? "已配對！" : "已加入排隊"));
    } catch (err) { next(err); }
  });
  router.post("/api/pk/leave", requireAuth, async (req, res, next) => {
    try {
      const r = await pkArena.webLeaveQueue(req.playerRecord.discordId);
      if (!r.ok) return res.status(400).json(fail("PK_LEAVE_FAILED", r.message));
      res.json(ok(r, "已離開排隊"));
    } catch (err) { next(err); }
  });
  router.post("/api/pk/bet", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { arenaIdx, side, amount } = req.body || {};
      const r = await pkArena.webPlaceBet({ discordId, name: displayName, arenaIdx: Number(arenaIdx), side, amount });
      if (!r.ok) return res.status(400).json(fail("PK_BET_FAILED", r.message));
      res.json(ok(r, `已押注 ${r.targetName}`));
    } catch (err) { next(err); }
  });
  router.get("/api/pk/last-result", requireAuth, async (req, res, next) => {
    try { res.json(ok(pkArena.webGetLastResult(req.playerRecord.discordId))); }
    catch (err) { next(err); }
  });

  // ──────────────────────────────────────────────────
  // 拍賣行（DC 拍賣面板）
  // ──────────────────────────────────────────────────
  async function getMemberRoleIds(discordId) {
    if (!discordClient) return [];
    const guildId = config.discord?.guildId;
    if (!guildId) return [];
    try {
      const guild = discordClient.guilds.cache.get(guildId)
        || await discordClient.guilds.fetch(guildId).catch(() => null);
      if (!guild) return [];
      const member = await guild.members.fetch({ user: discordId, force: false }).catch(() => null);
      if (!member) return [];
      return Array.from(member.roles.cache.keys());
    } catch (_) {
      return [];
    }
  }

  router.get("/api/auction/list", requireAuth, async (req, res, next) => {
    try {
      const { kind, currency } = req.query || {};
      const filters = {};
      if (kind && typeof kind === "string") filters.kind = kind;
      if (currency && typeof currency === "string") filters.currency = currency;
      const items = await serviceContext.auctionService.getActiveListings(filters);
      const enabled = await serviceContext.auctionService.isEnabled();
      // 階級高的(S)排最前面,讓最高級裝備一開始就看得到;同階維持原順序(最新在前)
      const TIER_RANK = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
      const sortedItems = [...(items || [])].sort((a, b) => {
        const at = TIER_RANK[String(a.tier || a.item?.tier || "").toUpperCase()] || 0;
        const bt = TIER_RANK[String(b.tier || b.item?.tier || "").toUpperCase()] || 0;
        return bt - at;
      });
      res.json(ok({
        enabled,
        listings: (sortedItems || []).map((a) => ({
          id: a.id || a._id?.toString(),
          itemUuid: a.itemUuid,
          itemName: a.itemName || a.item?.itemName,
          itemType: a.itemType || a.item?.itemType,
          tier: a.tier || a.item?.tier,
          quantity: a.quantity || 1,
          currency: a.currency,
          price: a.price,
          sellerId: a.sellerId,
          sellerName: a.sellerName,
          listedAt: a.listedAt || a.createdAt,
          expiresAt: a.expiresAt,
          status: a.status
        }))
      }));
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/auction/my", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const my = await serviceContext.auctionService.getMyListings(discordId);
      const roleIds = await getMemberRoleIds(discordId);
      const maxListings = await serviceContext.auctionService.getMaxListings(roleIds);
      const eligible = await serviceContext.auctionService.checkSellerEligibility(roleIds);
      const TIER_RANK = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
      const sortedMy = [...(my || [])].sort((a, b) =>
        (TIER_RANK[String(b.tier || b.item?.tier || "").toUpperCase()] || 0) -
        (TIER_RANK[String(a.tier || a.item?.tier || "").toUpperCase()] || 0));
      res.json(ok({
        listings: (sortedMy || []).map((a) => ({
          id: a.id || a._id?.toString(),
          itemUuid: a.itemUuid,
          itemName: a.itemName || a.item?.itemName,
          itemType: a.itemType || a.item?.itemType,
          tier: a.tier || a.item?.tier,
          quantity: a.quantity || 1,
          currency: a.currency,
          price: a.price,
          listedAt: a.listedAt || a.createdAt,
          expiresAt: a.expiresAt,
          status: a.status
        })),
        eligible,
        maxListings,
        activeCount: (my || []).filter((l) => l.status === "active").length
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/auction/list-item", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { itemUuid, currency, price, hours, quantity = 1 } = req.body || {};
      if (!itemUuid || !currency || !price || !hours) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "itemUuid / currency / price / hours 必填"));
      }
      const roleIds = await getMemberRoleIds(discordId);
      const result = await serviceContext.auctionService.listItem({
        sellerId: discordId,
        itemUuid,
        currency,
        price: Number(price),
        hours: Number(hours),
        quantity: Number(quantity) || 1,
        memberRoleIds: roleIds
      });
      res.json(ok(result, "上架成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("LIST_FAILED", err.message));
      }
      next(err);
    }
  });

  router.post("/api/auction/buy/:id", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const auctionId = String(req.params.id);
      const result = await serviceContext.auctionService.buyItem(discordId, auctionId);
      res.json(ok(result, "購買成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("BUY_FAILED", err.message));
      }
      next(err);
    }
  });

  router.post("/api/auction/cancel/:id", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const auctionId = String(req.params.id);
      const result = await serviceContext.auctionService.cancelListing(discordId, auctionId);
      res.json(ok(result, "下架成功"));
    } catch (err) {
      if (err?.message) {
        return res.status(400).json(fail("CANCEL_FAILED", err.message));
      }
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 交易紀錄（DC 玩家面板 → 交易紀錄）
  // ──────────────────────────────────────────────────
  router.get("/api/me/transactions", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const result = await serviceContext.transactionService.listRecentByDiscordId(discordId, displayName, limit);
      const transactions = (result.transactions || []).map((tx) => ({
        id: tx.id || tx._id?.toString(),
        type: tx.type,
        sourceTag: tx.sourceTag,
        amount: tx.amount,
        currency: tx.currency,
        balanceAfter: tx.balanceAfter ?? null,
        detail: tx.detail || null,
        occurredAt: tx.occurredAt || tx.createdAt
      }));
      res.json(ok({ transactions, count: transactions.length }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 邀請碼系統（DC 玩家面板 → 🎟️ 我的邀請碼 / 🎁 輸入邀請碼）
  // ──────────────────────────────────────────────────
  router.get("/api/me/invite", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      await serviceContext.playerService.ensurePlayer(discordId, displayName);
      const doc = await serviceContext.inviteService.getOrCreateCode(discordId);
      res.json(ok({
        code: doc.code,
        useCount: (doc.uses || []).length,
        uses: (doc.uses || []).slice(-10).map((u) => ({
          inviteeId: u.inviteeId,
          inviteeName: u.inviteeName,
          usedAt: u.usedAt
        }))
      }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/me/invite/use", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const rawCode = String(req.body?.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(rawCode)) {
        return res.status(400).json(fail("INVALID_ARGUMENT", "邀請碼格式錯誤（8 碼大寫英數）"));
      }
      await serviceContext.playerService.ensurePlayer(discordId, displayName);
      const result = await serviceContext.inviteService.useCode(rawCode, discordId);
      if (!result.ok) {
        return res.status(400).json(fail("INVITE_REJECTED", result.reason || "邀請碼無效"));
      }
      res.json(ok({
        inviterId: result.inviterId,
        inviterName: result.inviterName,
        rewards: result.rewards || {
          gold: 50000,
          gems: [{ tier: "D", count: 20 }, { tier: "C", count: 5 }]
        }
      }, "邀請碼兌換成功"));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 打卡狀態查詢（DC 我的資料 → 📅 打卡狀態）
  // ──────────────────────────────────────────────────
  router.get("/api/me/checkin", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 7));
      const checkins = await serviceContext.checkinService.listRecentByDiscordId(discordId, limit);

      // 算今日是否已打卡（用台北時區）
      const tz = "Asia/Taipei";
      const todayKey = new Date().toLocaleDateString("zh-TW", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
      const todayCheckin = (checkins || []).find((c) => {
        if (!c?.occurredAt) return false;
        const k = new Date(c.occurredAt).toLocaleDateString("zh-TW", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
        return k === todayKey;
      });

      res.json(ok({
        checkedToday: Boolean(todayCheckin),
        todayReward: todayCheckin?.rewardDetail?.amount ?? null,
        todayAt: todayCheckin?.occurredAt || null,
        history: (checkins || []).slice(0, limit).map((c) => ({
          date: c?.occurredAt ? new Date(c.occurredAt).toLocaleDateString("zh-TW", { timeZone: tz }) : null,
          amount: c?.rewardDetail?.amount ?? 0,
          occurredAt: c?.occurredAt || null
        }))
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
